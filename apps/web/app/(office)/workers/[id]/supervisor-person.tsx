import Link from 'next/link';
import { api } from '../../../../lib/api';
import { Badge, CREDENTIAL_STATUS_LABEL, formatDate, PROBLEM_LABEL, VERIFICATION_LABEL } from '../../../../lib/format';
import { T, words } from '../../../../lib/terms';
import type { CardData } from '../../../../lib/person-card';
import { PersonCard } from '../person-card';
import { businessZone, todayIn } from '../../../../lib/business';

type Person = {
  id: string; firstName: string; lastName: string; preferredName: string | null; status: string; roles: string[]; compliance: string;
  card?: CardData;
  credentials: { id: string; typeName: string; issuedBy?: string | null; issueDate: string | null; expiryDate: string | null; verification: string; status: string }[];
  issues: { credentialTypeId: string; typeName: string; severity: string; problem: string }[];
};
type Shift = { id: string; localDate: string; localStart: string; localEnd: string; facilityName: string; areaName: string | null; role: string; status: string };

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dayLabel = (d: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const STAGE: Record<string, string> = { assigned: 'Allocated', booked: 'Booked', open: 'Open', cancelled: 'Cancelled' };

/**
 * A person's page for a supervisor (David, 4 Nov, answer 2): what relates to the shift only. Their card, credentials
 * and licences (type, issuer, dates, checked or not), right to work as met or not, and their shifts at the
 * supervisor's sites. The API leaves everything else out (contact details, addresses, date of birth, notes, numbers,
 * files, right-to-work details, employment records, the audit log).
 */
export async function SupervisorPerson({ id }: { id: string }) {
  const tw = await words();
  const zone = await businessZone();
  const today = todayIn(zone);
  const [p, shifts] = await Promise.all([
    api<Person>(`/workers/${id}`),
    api<Shift[]>(`/shifts?from=${addDays(today, -14)}&to=${addDays(today, 42)}&workerId=${id}`).catch(() => [] as Shift[]),
  ]);
  const rtw = p.issues.find(i => i.credentialTypeId === 'right-to-work');
  const others = p.issues.filter(i => i.credentialTypeId !== 'right-to-work');
  const upcoming = shifts.filter(s => s.localDate >= today && s.status !== 'cancelled');
  return (
    <>
      <p style={{ margin: '0 0 8px' }}><Link href="/workers">← {tw.many(T.worker)}</Link></p>
      <PersonCard p={p} today={today} size="full" link={false} />
      <p className="muted small">You see what relates to their {tw.lower(T.shift, true)}: {tw.lower(T.role, true)}, {tw.lower(T.credential, true)} and right to work. Personal details stay with the office.</p>

      <div className="card">
        <h2>Right to work</h2>
        <p style={{ margin: 0 }}><Badge label={!rtw ? ['Met', 'ok'] : rtw.problem === 'expiring' ? ['Needs checking soon', 'warn'] : ['Not met', 'bad']} /></p>
      </div>

      {others.length > 0 && (
        <div className="card">
          <h2>To be compliant</h2>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {others.map(i => (
              <li key={`${i.typeName}-${i.problem}`}>{i.typeName}: {PROBLEM_LABEL[i.problem] ?? i.problem}{i.severity === 'warning' && <span className="muted"> (warning only)</span>}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>{tw.many(T.credential)}</h2>
        {p.credentials.length === 0 ? <p className="muted" style={{ margin: 0 }}>None recorded.</p> : (
          <table>
            <thead><tr><th>{tw.one(T.credential)}</th><th>Issued by</th><th>Issued</th><th>Expires</th><th>Checked</th></tr></thead>
            <tbody>{p.credentials.map(c => (
              <tr key={c.id}>
                <td>{c.typeName}</td>
                <td>{c.issuedBy ?? '—'}</td>
                <td>{c.issueDate ? formatDate(c.issueDate) : '—'}</td>
                <td>{c.expiryDate ? <>{formatDate(c.expiryDate)} <Badge label={CREDENTIAL_STATUS_LABEL[c.status]} /></> : '—'}</td>
                <td><Badge label={VERIFICATION_LABEL[c.verification]} /></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>Coming up <span className="muted small">(at your {tw.lower(T.site, true)}, next 6 weeks)</span></h2>
        {upcoming.length === 0 ? <p className="muted" style={{ margin: 0 }}>None.</p> : (
          <table>
            <thead><tr><th>Date</th><th>Time</th><th>{tw.one(T.site)}</th><th>{tw.one(T.role)}</th><th>Stage</th></tr></thead>
            <tbody>{upcoming.map(x => (
              <tr key={x.id}>
                <td><Link href={`/roster?span=day&date=${x.localDate}&shift=${x.id}#shift-panel`}>{dayLabel(x.localDate)}</Link></td>
                <td>{x.localStart}–{x.localEnd}</td>
                <td>{x.facilityName}{x.areaName && <span className="muted"> · {x.areaName}</span>}</td>
                <td>{x.role}</td>
                <td>{STAGE[x.status] ?? x.status}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
