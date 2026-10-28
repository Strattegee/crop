import { api } from '../../../lib/api';
import { currentAgency } from '../../../lib/current-user';
import { Badge } from '../../../lib/format';
import { businessZone, whenIn } from '../../../lib/business';
import { Notices } from '../notices';
import { sendTest } from './actions';

export const dynamic = 'force-dynamic';

type Message = {
  id: string; channel: string; to: string; template: string; subject: string | null; body: string; status: string;
  attempts: number; error: string | null; createdAt: string; workerName: string | null;
};
type Log = { messages: Message[]; smsThisMonth: number; smsMonthlyCap: number; emailReady: boolean; smsReady: boolean };

const STATUS: Record<string, [string, 'ok' | 'warn' | 'bad' | 'neutral']> = {
  queued: ['Queued', 'neutral'], sending: ['Sending', 'neutral'], sent: ['Sent', 'ok'], failed: ['Failed', 'bad'], skipped: ['Not sent', 'warn'],
};
const TEMPLATE: Record<string, string> = { test: 'Test', credential_expiry: 'Expiry reminder', compliance_expiry: 'Office expiry alert', welcome: 'Welcome', shift_offer: 'Shift offer', shift_booked: 'Shift booked', shift_filled: 'Shift filled', roster_published: 'Roster published', change_request: 'Change request', change_request_decided: 'Change request decided', onboarding_request: 'Onboarding request' };


export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const [log, agency, sp, zone] = await Promise.all([api<Log>('/notifications'), currentAgency(), searchParams, businessZone()]);
  const when = whenIn(zone);
  const canTest = agency?.role === 'owner' || agency?.role === 'admin';
  return (
    <>
      <h1>Messages</h1>
      <p className="muted">Every email and text CROP sends for your business.</p>
      <Notices error={sp.error} done={sp.done} />

      <div className="grid">
        <div className="card"><div className="muted">Email</div><div className="stat" style={{ fontSize: 20 }}>{log.emailReady ? 'Ready' : 'Not set up'}</div></div>
        <div className="card"><div className="muted">SMS</div><div className="stat" style={{ fontSize: 20 }}>{log.smsReady ? 'Ready' : 'Not set up'}</div></div>
        <div className="card"><div className="muted">Texts this month</div><div className="stat" style={{ fontSize: 20 }}>{log.smsThisMonth} of {log.smsMonthlyCap}</div></div>
      </div>

      {canTest && (
        <div className="card">
          <h2>Send a test</h2>
          <form action={sendTest} className="form-row" style={{ alignItems: 'center' }}>
            <input type="hidden" name="channel" value="email" />
            <button type="submit" className="btn secondary">Email me a test</button>
            <span className="muted">Sends to the email address you signed in with.</span>
          </form>
          {log.smsReady ? (
            <form action={sendTest} className="form-row" style={{ marginTop: 12 }}>
              <input type="hidden" name="channel" value="sms" />
              <label>Mobile for a test text<input name="to" required placeholder="0412 345 678" maxLength={20} inputMode="tel" /></label>
              <button type="submit" className="btn secondary">Text a test</button>
            </form>
          ) : (
            <p className="muted" style={{ marginBottom: 0 }}>Text tests appear here once SMS is set up.</p>
          )}
        </div>
      )}

      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>Recent messages</h2>
        {log.messages.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nothing sent yet.</p> : (
          <table>
            <thead><tr><th>When</th><th>Type</th><th>To</th><th>Message</th><th>Status</th></tr></thead>
            <tbody>
              {log.messages.map(m => (
                <tr key={m.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{when(m.createdAt)}</td>
                  <td>{m.channel === 'sms' ? 'Text' : 'Email'} · {TEMPLATE[m.template] ?? m.template}</td>
                  <td>{m.workerName ? <>{m.workerName}<br /></> : null}<span className="muted">{m.to}</span></td>
                  <td style={{ maxWidth: 360 }}>{m.subject && <strong>{m.subject}<br /></strong>}<span className="muted">{m.body.length > 140 ? `${m.body.slice(0, 140)}…` : m.body}</span></td>
                  <td>
                    <Badge label={STATUS[m.status]} />
                    {m.error && <div className="muted" style={{ fontSize: 12 }}>{m.error}{m.status === 'queued' ? ' (will retry)' : ''}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
