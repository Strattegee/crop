/**
 * Staging demo helpers (only reached when DEMO_TOOLS=on). They touch invented demo people only:
 * workers whose email ends in @example.com. Real people are never changed.
 */
import { api } from '../../lib/api';

const post = <T = { id: string }>(p: string, body: unknown) => api<T>(p, { method: 'POST', body });
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const melbourneToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' }).format(new Date());

type Rule = { credentialTypeId: string; scope: 'all_workers' | 'role'; role: string | null };
type CType = { id: string; hasNumber: boolean; hasExpiry: boolean; active: boolean };
type Worker = { id: string; email: string | null; status: string; roles: string[] };
type Cred = { credentialTypeId: string; verification: string; expiryDate: string | null };

/** Gives every demo person the right to work and each credential the business's rules ask of them, verified and current. */
export async function completeDemoCredentials(opts: { workerIds?: string[]; businessWideOnly?: boolean } = {}) {
  const today = melbourneToday();
  const [rules, types, workers] = await Promise.all([
    api<Rule[]>('/credential-requirements'), api<CType[]>('/credential-types'), api<Worker[] | { workers: Worker[] }>('/workers?status=active'),
  ]);
  const list = (Array.isArray(workers) ? workers : workers.workers).filter(w => w.email?.endsWith('@example.com') && (!opts.workerIds || opts.workerIds.includes(w.id)));
  const typeById = new Map(types.map(t => [t.id, t]));
  let added = 0;
  const one = async (w: Worker) => {
    const rtw = await api<{ current: unknown | null }>(`/workers/${w.id}/right-to-work`);
    if (!rtw.current) {
      await api(`/workers/${w.id}/right-to-work`, { method: 'PUT', body: { status: 'citizen', citizenProofType: 'au_passport', documentNumber: 'DEMO0000' } });
      await post(`/workers/${w.id}/right-to-work/verify`, { note: 'Demo data' });
    }
    const detail = await api<{ credentials: Cred[] }>(`/workers/${w.id}`);
    const need = new Set(rules.filter(r => r.scope === 'all_workers' || (!opts.businessWideOnly && r.role && w.roles.includes(r.role))).map(r => r.credentialTypeId));
    for (const typeId of need) {
      const t = typeById.get(typeId);
      if (!t?.active) continue;
      const ok = detail.credentials.some(c => c.credentialTypeId === typeId && c.verification === 'verified' && (!c.expiryDate || c.expiryDate > addDays(today, 45)));
      if (ok) continue;
      const c = await post(`/workers/${w.id}/credentials`, {
        credentialTypeId: typeId, number: t.hasNumber ? `DEMO-${typeId.slice(0, 6)}` : undefined,
        issueDate: addDays(today, -200), expiryDate: t.hasExpiry ? addDays(today, 300 + (w.id.charCodeAt(0) % 200)) : undefined,
      });
      await post(`/workers/${w.id}/credentials/${c.id}/verify`, { note: 'Demo data' });
      added++;
    }
  };
  for (let i = 0; i < list.length; i += 4) await Promise.all(list.slice(i, i + 4).map(one));
  return { people: list.length, added };
}

/** Fills the week's open shifts with the first ready person CROP suggests (eligibility rules still apply). */
export async function fillOpenShifts(week: string) {
  type S = { id: string; status: string; equipmentOnly?: boolean };
  const shifts = (await api<S[]>(`/shifts?from=${week}&to=${addDays(week, 6)}&status=open`)).filter(s => !s.equipmentOnly);
  let filled = 0;
  for (const s of shifts) {
    const { candidates } = await api<{ candidates: { workerId: string; eligible: boolean }[] }>(`/shifts/${s.id}/candidates`);
    for (const c of candidates.filter(x => x.eligible).slice(0, 3)) {
      try {
        await post(`/shifts/${s.id}/assign`, { workerId: c.workerId });
        await post(`/shifts/${s.id}/confirm`, {});
        filled++;
        break;
      } catch { /* next */ }
    }
  }
  return { open: shifts.length, filled };
}
