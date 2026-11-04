/**
 * Who can see and change each piece of a person's details (David, 3 Nov 2026, answer 5; migration 0085). The office
 * always sees and changes everything; each business chooses what the person gets in the app for each field:
 * office only (`hidden`), `see`, change with the office's approval (`approve`), or `change`. Pure: no database access.
 *
 * Date of birth is not on the list: it stays with the office (the under-18 rules, migration 0082). Credentials and
 * right to work keep their own rules (the person adds, the office verifies).
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

/** The words for each level, as the settings page and the app say them. */
export const ACCESS_WORDS: Record<Access, string> = {
  hidden: 'Office only',
  see: 'They can see it',
  approve: 'They can change it; the office approves',
  change: 'They can change it',
};

const isField = (v: unknown): v is PersonField => typeof v === 'string' && (PERSON_FIELDS as readonly string[]).includes(v);
const isAccess = (v: unknown): v is Access => typeof v === 'string' && (ACCESS_LEVELS as readonly string[]).includes(v);

/** The business's settings with CROP's default for every field it hasn't chosen (and for anything stored that's no longer allowed). */
export function accessOf(stored: { field: string; person: string }[]): Record<PersonField, Access> {
  const out = { ...FIELD_DEFAULTS };
  for (const r of stored) if (isField(r.field) && isAccess(r.person) && FIELD_RULES[r.field].allowed.includes(r.person)) out[r.field] = r.person;
  return out;
}

/**
 * Reads `{ fields: { mobile: 'change', … } }` (any subset). Returns the changes or a plain problem; a level a field
 * can't have is refused with the reason.
 */
export function parseAccess(body: Record<string, unknown>): { changes: Partial<Record<PersonField, Access>> } | { problem: string } {
  const fields = body.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return { problem: 'Say who can see and change each field' };
  const changes: Partial<Record<PersonField, Access>> = {};
  for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
    if (!isField(k)) return { problem: `There is no field called “${k}”` };
    if (!isAccess(v)) return { problem: `Choose who can see and change ${FIELD_RULES[k].label.toLowerCase()}` };
    if (!FIELD_RULES[k].allowed.includes(v)) {
      return { problem: `${FIELD_RULES[k].label} can’t be “${ACCESS_WORDS[v].toLowerCase()}”${FIELD_RULES[k].note ? `: ${FIELD_RULES[k].note}` : ''}` };
    }
    changes[k] = v;
  }
  return { changes };
}

/** One row of the settings list. */
export function accessList(access: Record<PersonField, Access>) {
  return PERSON_FIELDS.map(f => ({
    field: f, label: FIELD_RULES[f].label, person: access[f], isDefault: access[f] === FIELD_DEFAULTS[f],
    defaultPerson: FIELD_DEFAULTS[f], allowed: [...FIELD_RULES[f].allowed], note: FIELD_RULES[f].note ?? null,
  }));
}

/** What the app can do with a field: shown at all, changed straight away, or changed once the office approves. */
export function personCan(a: Access): { see: boolean; change: boolean; needsApproval: boolean } {
  return { see: a !== 'hidden', change: a === 'change' || a === 'approve', needsApproval: a === 'approve' };
}
