import type { PoolClient } from 'pg';
import { todayIn, workerCompliance, type CredentialFacts, type RequirementRule, type RightToWorkFacts } from './compliance.js';
import { loadSettings } from './settings.js';

/** Loads what's needed to work out compliance for many workers at once (within withTenant). */
export async function complianceContext(db: PoolClient, tenantId: string) {
  const settings = await loadSettings(db, tenantId);
  const rules = (await db.query<{ credential_type_id: string; name: string; scope: 'all_workers' | 'role'; role: string | null; severity: 'hard' | 'warning' }>(
    `select r.credential_type_id, t.name, r.scope, r.role, r.severity
       from credential_requirements r join credential_types t on t.id = r.credential_type_id
      where t.active`,
  )).rows.map<RequirementRule>(r => ({ credentialTypeId: r.credential_type_id, typeName: r.name, scope: r.scope, role: r.role, severity: r.severity }));
  const today = todayIn(settings.timezone);
  return {
    settings,
    rules,
    today,
    /** `extraRules`: rules from the duties on a shift (they apply to whoever works it). */
    evaluate(roles: string[], credentials: CredentialFacts[], rightToWork: RightToWorkFacts | null, onDate = today, extraRules: RequirementRule[] = []) {
      return workerCompliance(roles, extraRules.length ? [...rules, ...extraRules] : rules, credentials, onDate, settings.expiringWindowDays, rightToWork);
    },
  };
}

export async function credentialFactsByWorker(db: PoolClient, workerIds?: string[]): Promise<Map<string, CredentialFacts[]>> {
  const { rows } = await db.query<{ id: string; worker_id: string; credential_type_id: string; expiry_date: string | null; verification: CredentialFacts['verification'] }>(
    `select id, worker_id, credential_type_id, to_char(expiry_date, 'YYYY-MM-DD') as expiry_date, verification
       from worker_credentials ${workerIds ? 'where worker_id = any($1)' : ''}`,
    workerIds ? [workerIds] : [],
  );
  const map = new Map<string, CredentialFacts[]>();
  for (const r of rows) {
    const list = map.get(r.worker_id) ?? [];
    list.push({ id: r.id, credentialTypeId: r.credential_type_id, expiryDate: r.expiry_date, verification: r.verification });
    map.set(r.worker_id, list);
  }
  return map;
}

/** Current right-to-work record per worker (within withTenant). */
export async function rightToWorkByWorker(db: PoolClient, workerIds?: string[]): Promise<Map<string, RightToWorkFacts>> {
  const { rows } = await db.query<{ id: string; worker_id: string; status: RightToWorkFacts['status']; verification: RightToWorkFacts['verification']; visa_expiry: string | null; vevo_result: string | null }>(
    `select id, worker_id, status, verification, to_char(visa_expiry, 'YYYY-MM-DD') as visa_expiry, vevo_result
       from right_to_work_records where superseded_at is null ${workerIds ? 'and worker_id = any($1)' : ''}`,
    workerIds ? [workerIds] : [],
  );
  return new Map(rows.map(r => [r.worker_id, {
    id: r.id, status: r.status, verification: r.verification, visaExpiry: r.visa_expiry, vevoConfirmed: r.vevo_result === 'confirmed',
  }]));
}
