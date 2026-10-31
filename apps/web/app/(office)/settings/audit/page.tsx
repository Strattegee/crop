import Link from 'next/link';
import { api } from '../../../../lib/api';
import { auditValue, auditWho } from '../../../../lib/audit';
import { businessZone, whenIn } from '../../../../lib/business';
import { currentAgency } from '../../../../lib/current-user';

export const dynamic = 'force-dynamic';

type Entry = {
  id: string; at: string; table: string; what: string; action: 'insert' | 'update' | 'delete'; by: string | null; via: string; summary: string;
  fields: { key: string; label: string; old: unknown; new: unknown }[];
};
type Page = { rows: Entry[]; more: string | null; tables?: { key: string; label: string }[] };

/**
 * The audit log (function 9160; spec: every create, change and delete with who, when and old and new values, which
 * nobody can edit). Owners and administrators only. `?worker=<id>` shows everything about one person.
 */
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ table?: string; from?: string; to?: string; before?: string; worker?: string; name?: string }> }) {
  const [sp, agency, zone] = await Promise.all([searchParams, currentAgency(), businessZone()]);
  const allowed = agency?.role === 'owner' || agency?.role === 'admin';
  const when = whenIn(zone);
  const qs = new URLSearchParams();
  for (const k of ['table', 'from', 'to', 'before'] as const) if (sp[k]) qs.set(k, sp[k]!);
  const data: Page | null = !allowed ? null : sp.worker
    ? await api<Page>(`/workers/${encodeURIComponent(sp.worker)}/audit${sp.before ? `?before=${sp.before}` : ''}`).catch(() => null)
    : await api<Page>(`/audit?${qs}`).catch(() => null);
  const tables = data?.tables ?? [];
  const next = new URLSearchParams(qs); if (data?.more) next.set('before', data.more);
  if (sp.worker) { next.set('worker', sp.worker); if (sp.name) next.set('name', sp.name); }

  return (
    <>
      <p className="muted small"><Link href="/settings">Settings</Link> ›</p>
      <h1>{sp.worker ? `Audit log: ${sp.name ?? 'one person'}` : 'Audit log'}</h1>
      <p className="muted">Every record added, changed or removed in your business: who did it, when, and what it was before and after. Nobody can change this log.</p>
      {!allowed && <div className="notice error">Only owners and administrators can see the audit log.</div>}
      {allowed && !sp.worker && (
        <form className="card form-row" method="get">
          <label>What
            <select name="table" defaultValue={sp.table ?? ''}>
              <option value="">Everything</option>
              {tables.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
          <label>From<input type="date" name="from" defaultValue={sp.from ?? ''} /></label>
          <label>To<input type="date" name="to" defaultValue={sp.to ?? ''} /></label>
          <button className="btn small">Show</button>
          {(sp.table || sp.from || sp.to) && <Link href="/settings/audit" className="small">Clear</Link>}
        </form>
      )}
      {sp.worker && <p><Link href={`/workers/${sp.worker}`}>Back to {sp.name ?? 'their page'}</Link> · <Link href="/settings/audit">The whole log</Link></p>}
      {allowed && !data && <div className="notice error">The audit log couldn’t be loaded.</div>}
      {data && (
        <div className="card" style={{ overflowX: 'auto' }}>
          {data.rows.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nothing recorded{sp.table || sp.from || sp.to ? ' for this choice' : ' yet'}.</p> : (
            <table className="audit-table">
              <thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
              <tbody>
                {data.rows.map(r => (
                  <tr key={r.id}>
                    <td className="nowrap">{when(r.at)}</td>
                    <td>{auditWho(r.by, r.via)}</td>
                    <td>
                      {r.fields.length === 0 ? r.summary : (
                        <details>
                          <summary>{r.summary}</summary>
                          <table className="audit-fields">
                            <tbody>
                              {r.fields.map(f => (
                                <tr key={f.key}>
                                  <th>{f.label}</th>
                                  {r.action === 'update' && <td className="muted">{auditValue(f.old, when)}</td>}
                                  {r.action === 'update' && <td aria-hidden="true">→</td>}
                                  <td>{auditValue(r.action === 'delete' ? f.old : f.new, when)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data.more && <p><Link href={`/settings/audit?${next}`}>Older entries</Link></p>}
        </div>
      )}
    </>
  );
}
