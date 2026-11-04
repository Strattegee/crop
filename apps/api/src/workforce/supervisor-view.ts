/**
 * What a supervisor sees about people (David, 4 Nov, answer 2: "things related to the shift: quals, credentials,
 * licences etc."). Pure. Supervisors get names, roles, credentials and licences (type, issuer, dates, whether they're
 * checked), right to work as met or not, the person card's work facts, and eligibility reasons worded without visa
 * or VEVO detail. Never contact details, addresses, date of birth, gender (except on a shift that asks for one), notes,
 * credential numbers, files or check notes, right-to-work details, employment records or the audit log.
 * The database also keeps addresses, files, histories, calls, messages and the audit log out of their reach
 * (migration 0086's `not_supervisor` policies).
 */

type Row = Record<string, unknown>;

/**
 * The business's vaccination credential types (health information). A supervisor sees them only as "Vaccination
 * record", like messages do: whether it's held and current, never which vaccination.
 */
export interface HealthTypes { ids: Set<string>; names: Set<string> }
export const NO_HEALTH: HealthTypes = { ids: new Set(), names: new Set() };
export const VACCINATION_WORD = 'Vaccination record';

/** The fields of a person a supervisor gets (GET /workers rows and GET /workers/:id). */
export const SUPERVISOR_WORKER_FIELDS = ['id', 'firstName', 'lastName', 'preferredName', 'status', 'roles', 'compliance', 'issueCount', 'today'] as const;

/** The fields of a credential a supervisor gets. */
export const SUPERVISOR_CREDENTIAL_FIELDS = ['id', 'credentialTypeId', 'typeName', 'category', 'issuedBy', 'issueDate', 'expiryDate', 'verification', 'verifiedAt', 'status'] as const;

const pick = (row: Row, fields: readonly string[]): Row => Object.fromEntries(fields.filter(f => f in row).map(f => [f, row[f]]));

/** The person card without the visa's date or the under-18 flag (which comes from the date of birth). */
export function supervisorCard(card: Row | undefined | null, health: HealthTypes = NO_HEALTH): Row | null {
  if (!card) return null;
  const next = card.nextExpiry as { name: string; date: string } | null | undefined;
  const { under18: _u, ...rest } = card;
  const out: Row = { ...rest, nextExpiry: !next || next.name === 'Visa' ? null : health.names.has(next.name) ? { ...next, name: VACCINATION_WORD } : next };
  if (Array.isArray(card.held)) out.held = [...new Set((card.held as string[]).map(n => (health.names.has(n) ? VACCINATION_WORD : n)))];
  return out;
}

/** A compliance issue as a supervisor sees it: right to work only as "not met". */
export function supervisorIssue<T extends { credentialTypeId: string; problem: string; credentialId?: string | null; typeName?: string }>(i: T, health: HealthTypes = NO_HEALTH): T {
  if (health.ids.has(i.credentialTypeId)) return { ...i, typeName: VACCINATION_WORD };
  if (i.credentialTypeId !== 'right-to-work') return i;
  return { ...i, problem: i.problem === 'expiring' ? 'expiring' : 'missing', credentialId: null };
}

/** A person's row or record for a supervisor (list rows and the person's page). */
export function supervisorWorker(row: Row, health: HealthTypes = NO_HEALTH): Row {
  const out = pick(row, SUPERVISOR_WORKER_FIELDS);
  if ('card' in row) out.card = supervisorCard(row.card as Row, health);
  if (Array.isArray(row.credentials)) {
    out.credentials = (row.credentials as Row[]).map(c => {
      const x = { ...pick(c, SUPERVISOR_CREDENTIAL_FIELDS), documents: [] as unknown[] };
      return health.ids.has(String(c.credentialTypeId)) ? { ...x, typeName: VACCINATION_WORD, category: 'vaccination', issuedBy: null } : x;
    });
  }
  if (Array.isArray(row.issues)) out.issues = (row.issues as Array<{ credentialTypeId: string; problem: string }>).map(i => supervisorIssue(i, health));
  if (Array.isArray(row.optional)) {
    out.optional = (row.optional as Array<{ credentialTypeId: string }>).map(o => (health.ids.has(o.credentialTypeId) ? { ...o, typeName: VACCINATION_WORD } : o));
  }
  out.limitedView = true;
  return out;
}

export interface ReasonLike { code: string; message: string }

/**
 * Eligibility reasons for a supervisor: right to work and visa hours say only that the rule isn't met (no visa,
 * VEVO or hours detail); everything else is already about the shift and stays as it is.
 */
export function supervisorReason<R extends ReasonLike>(r: R, name: string, blocking: boolean, health: HealthTypes = NO_HEALTH): R {
  if (r.code === 'credential') {
    for (const n of health.names) {
      if (r.message.startsWith(`${name}'s ${n} `)) return { ...r, message: `${name}'s vaccination record ${r.message.slice(`${name}'s ${n} `.length)}` };
    }
  }
  if (r.code === 'right_to_work') {
    return { ...r, message: blocking ? `${name}'s right to work isn't met for this {shift}` : `${name}'s right to work needs checking soon` };
  }
  if (r.code === 'visa_hours') return { ...r, message: `${name} can't work more hours in this fortnight` };
  return r;
}

/** Applies supervisorReason to a whole eligibility result. */
export function supervisorEligibility<E extends { blocks: ReasonLike[]; warnings: ReasonLike[] }>(e: E, name: string, health: HealthTypes = NO_HEALTH): E {
  return {
    ...e,
    blocks: e.blocks.map(b => supervisorReason(b, name, true, health)),
    warnings: e.warnings.map(w => supervisorReason(w, name, false, health)),
  };
}

/** The business's vaccination types (within withTenant). */
export async function healthTypes(db: { query: <R>(sql: string) => Promise<{ rows: R[] }> }): Promise<HealthTypes> {
  const rows = (await db.query<{ id: string; name: string }>(`select id, name from credential_types where category = 'vaccination'`)).rows;
  return { ids: new Set(rows.map(r => r.id)), names: new Set(rows.map(r => r.name)) };
}

/** A shift row for a supervisor: the person's own gender only when the shift asks for one (it's then about the shift). */
export function supervisorShift<S extends { genderRequested?: unknown; workerGender?: unknown }>(s: S): S {
  return s.genderRequested ? s : { ...s, workerGender: null };
}
