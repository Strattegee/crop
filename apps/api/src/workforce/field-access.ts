/**
 * Who can see and change each piece of a person's details (David, 3 Nov 2026, answer 5; migration 0085). The office
 * always sees and changes everything; each business chooses what the person gets in the app for each field:
 * office only (`hidden`), `see`, change with the office's approval (`approve`), or `change`. Pure: no database access.
 *
 * Date of birth is not on the list: it stays with the office (the under-18 rules, migration 0082).
 *
 * Documents (answer 5's "and each document"; migration 0088): each kind of credential (licences, registrations,
 * training, checks, vaccinations) and right to work has its own setting too: office only, they can see it, or they can
 * send it in the app (the office always checks it, so "change" is never offered). Upload links the office sends work
 * whatever is set here: the office chose to ask.
 */
export const ACCESS_LEVELS = ['hidden', 'see', 'approve', 'change'] as const;
export type Access = typeof ACCESS_LEVELS[number];

export const PERSON_FIELDS = ['name', 'preferred_name', 'email', 'mobile', 'addresses', 'gender'] as const;
export type PersonField = typeof PERSON_FIELDS[number];

interface FieldRule {
  label: string;
  /** What a business may choose for it. */
  allowed: readonly Access[];
  /** CROP's choice until the business makes its own: self-service first (David), except where it reaches others. */
  fallback: Access;
  /** Plain note for the settings page. */
  note?: string;
}

export const FIELD_RULES: Record<PersonField, FieldRule> = {
  name: {
    label: 'Name', allowed: ['see', 'approve'], fallback: 'see',
    note: 'The app always greets them by name, so it can’t be office only.',
  },
  preferred_name: { label: 'Preferred name', allowed: ACCESS_LEVELS, fallback: 'change' },
  email: {
    label: 'Email', allowed: ['hidden', 'see', 'approve'], fallback: 'see',
    note: 'Their sign-in stays the same; a new email here is where the office’s messages go, so a change always needs approval.',
  },
  mobile: { label: 'Mobile', allowed: ACCESS_LEVELS, fallback: 'change' },
  addresses: { label: 'Addresses', allowed: ACCESS_LEVELS, fallback: 'change', note: 'Earlier addresses are always kept.' },
  gender: { label: 'Gender', allowed: ACCESS_LEVELS, fallback: 'hidden' },
};

export const FIELD_DEFAULTS: Record<PersonField, Access> =
  Object.fromEntries(PERSON_FIELDS.map(f => [f, FIELD_RULES[f].fallback])) as Record<PersonField, Access>;

// ---- Documents ----

/** Credential categories (migration 0003's `credential_category`, less the old right-to-work one) plus right to work. */
export const DOC_KINDS = ['licence', 'registration', 'training', 'check', 'vaccination', 'right_to_work'] as const;
export type DocKind = typeof DOC_KINDS[number];
export const DOC_FIELDS = DOC_KINDS.map(k => `doc_${k}` as const);
export type DocField = typeof DOC_FIELDS[number];
export type AccessField = PersonField | DocField;
export const ACCESS_FIELDS: readonly AccessField[] = [...PERSON_FIELDS, ...DOC_FIELDS];

const DOC_LEVELS: readonly Access[] = ['hidden', 'see', 'approve'];
export const DOC_RULES: Record<DocField, FieldRule> = {
  doc_licence: { label: 'Licences', allowed: DOC_LEVELS, fallback: 'approve' },
  doc_registration: { label: 'Registrations', allowed: DOC_LEVELS, fallback: 'approve' },
  doc_training: { label: 'Training and tickets', allowed: DOC_LEVELS, fallback: 'approve' },
  doc_check: { label: 'Checks', allowed: DOC_LEVELS, fallback: 'approve', note: 'For example a police check.' },
  doc_vaccination: {
    label: 'Vaccinations', allowed: DOC_LEVELS, fallback: 'approve',
    note: 'Health information: messages only ever say “a vaccination record”.',
  },
  doc_right_to_work: {
    label: 'Right to work', allowed: ['see', 'approve'], fallback: 'approve',
    note: 'The office records the details. It always shows, because nobody can be rostered without it.',
  },
};
export const DOC_DEFAULTS: Record<DocField, Access> =
  Object.fromEntries(DOC_FIELDS.map(f => [f, DOC_RULES[f].fallback])) as Record<DocField, Access>;

/** The words for each level for documents: sending one always means the office checks it. */
export const DOC_WORDS: Record<Access, string> = {
  hidden: 'Office only',
  see: 'They can see it',
  approve: 'They can send it; the office checks it',
  change: 'They can send it; the office checks it',
};

const ruleOf = (f: AccessField): FieldRule => (f in FIELD_RULES ? FIELD_RULES[f as PersonField] : DOC_RULES[f as DocField]);
const defaultOf = (f: AccessField): Access => ruleOf(f).fallback;

/** The setting for a credential's category ('right_to_work' covers the old right-to-work credential category too). */
export function docAccess(access: Record<AccessField, Access>, category: string): Access {
  const f = `doc_${category}` as DocField;
  return (DOC_FIELDS as readonly string[]).includes(f) ? access[f] : 'approve';
}

/** The words for each level, as the settings page and the app say them. */
export const ACCESS_WORDS: Record<Access, string> = {
  hidden: 'Office only',
  see: 'They can see it',
  approve: 'They can change it; the office approves',
  change: 'They can change it',
};

const isField = (v: unknown): v is AccessField => typeof v === 'string' && (ACCESS_FIELDS as readonly string[]).includes(v);
const isAccess = (v: unknown): v is Access => typeof v === 'string' && (ACCESS_LEVELS as readonly string[]).includes(v);

/** The business's settings with CROP's default for every field it hasn't chosen (and for anything stored that's no longer allowed). */
export function accessOf(stored: { field: string; person: string }[]): Record<AccessField, Access> {
  const out: Record<AccessField, Access> = { ...FIELD_DEFAULTS, ...DOC_DEFAULTS };
  for (const r of stored) if (isField(r.field) && isAccess(r.person) && ruleOf(r.field).allowed.includes(r.person)) out[r.field] = r.person;
  return out;
}

/**
 * Reads `{ fields: { mobile: 'change', … } }` (any subset). Returns the changes or a plain problem; a level a field
 * can't have is refused with the reason.
 */
export function parseAccess(body: Record<string, unknown>): { changes: Partial<Record<AccessField, Access>> } | { problem: string } {
  const fields = body.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return { problem: 'Say who can see and change each field' };
  const changes: Partial<Record<AccessField, Access>> = {};
  for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
    if (!isField(k)) return { problem: `There is no field called “${k}”` };
    const rule = ruleOf(k);
    if (!isAccess(v)) return { problem: `Choose who can see and change ${rule.label.toLowerCase()}` };
    if (!rule.allowed.includes(v)) {
      const words = k in FIELD_RULES ? ACCESS_WORDS : DOC_WORDS;
      const why = rule.note ?? (k in FIELD_RULES ? '' : 'The office always checks a document.');
      return { problem: `${rule.label} can’t be “${words[v].toLowerCase()}”${why ? `: ${why}` : ''}` };
    }
    changes[k] = v;
  }
  return { changes };
}

/** One row of the settings list: personal details first (`group: 'details'`), then documents. */
export function accessList(access: Record<AccessField, Access>) {
  return ACCESS_FIELDS.map(f => ({
    field: f, group: f in FIELD_RULES ? 'details' as const : 'documents' as const, label: ruleOf(f).label, person: access[f],
    isDefault: access[f] === defaultOf(f), defaultPerson: defaultOf(f), allowed: [...ruleOf(f).allowed], note: ruleOf(f).note ?? null,
  }));
}

/** What the app can do with a field: shown at all, changed straight away, or changed once the office approves. */
export function personCan(a: Access): { see: boolean; change: boolean; needsApproval: boolean } {
  return { see: a !== 'hidden', change: a === 'change' || a === 'approve', needsApproval: a === 'approve' };
}
