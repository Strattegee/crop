import type { PoolClient } from 'pg';
import { todayIn, workerCompliance, type CredentialFacts, type RequirementRule } from './compliance.js';
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
    evaluate(roles: string[], credentials: CredentialFacts[], onDate = today) {
      return workerCompliance(roles, rules, credentials, onDate, settings.expiringWindowDays);
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
