import { cookies } from 'next/headers';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { whenIn, businessZone } from '../../../../lib/business';
import { currentAgency } from '../../../../lib/current-user';
import { T, words } from '../../../../lib/terms';
import { Notices } from '../../notices';
import { addOutsideAgency, cancelInvite, createInvite, endLink, moveAgency, saveOutsideAgency, setBookMode, setTiming, switchOutsideAgency } from './actions';
import { TIMING_BANDS, minutesWords, stepChoices, type AgencyTiming } from '../../../../lib/agency-timing';
import { NEW_LINK_COOKIE } from './invite-cookie';

export const dynamic = 'force-dynamic';

type LinkRow = {
  connectionId: string; side: 'employer' | 'agency'; otherName: string; status: 'matching' | 'active' | 'ended'; statusWords: string;
  preference: number | null; bookMode: 'automatic' | 'approve_first'; createdAt: string; endedAt: string | null;
  endedByName: string | null; endedBySide: 'employer' | 'agency' | null; endReason: string | null;
};
type Outside = { id: string; name: string; email: string; phone: string | null; notes: string | null; active: boolean; emailsSent: number; lastSentAt: string | null };
type Invite = { id: string; forName: string | null; createdByName: string | null; createdAt: string; expiresAt: string; state: 'pending' | 'used' | 'cancelled' | 'expired'; acceptedBy: string | null };

const art = (w: string) => `${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w}`;

const INVITE_STATE: Record<Invite['state'], string> = { pending: 'Waiting', used: 'Accepted', cancelled: 'Cancelled', expired: 'Expired' };

/**
 * Agencies (function 9140, backlog item 7): link with agencies that also use CROP. An owner or admin makes a one-off
 * invitation link and sends it to the agency; the agency confirms it while signed in. Also lists the businesses this
 * one supplies as an agency.
 */
export default async function AgenciesPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const tw = await words();
  const [data, agency, sp, zone, settings, outside] = await Promise.all([
    api<{ links: LinkRow[]; invitations: Invite[] }>('/agency-links'), currentAgency(), searchParams, businessZone(),
    api<{ agencyTiming: AgencyTiming }>('/settings'),
    api<Outside[]>('/outside-agencies').catch(() => [] as Outside[]),
  ]);
  const timing = settings.agencyTiming;
  const newLink = (await cookies()).get(NEW_LINK_COOKIE)?.value;
  const when = whenIn(zone);
  const canEdit = agency?.role === 'owner' || agency?.role === 'admin';
  const agencies = tw.lower(T.agency, true);
  const anAgency = tw.lower(T.agency);
  const shifts = tw.lower(T.shift, true);
  const weUse = data.links.filter(l => l.side === 'employer' && l.status !== 'ended');
  const weSupply = data.links.filter(l => l.side === 'agency' && l.status !== 'ended');
  const ended = data.links.filter(l => l.status === 'ended');
  const order = weUse.map(l => l.connectionId);
  const pending = data.invitations.filter(i => i.state === 'pending');
  const recent = data.invitations.filter(i => i.state !== 'pending');

  return (
    <>
      <p className="muted small"><Link href="/settings">Settings</Link> ›</p>
      <h1>{tw.many(T.agency)}</h1>
      <p className="muted">
        Link with {agencies} that also use CROP, so you can send them {shifts} you can’t fill yourself. You make an invitation link and send it to
        the {anAgency}; they open it while signed in to CROP and confirm. Before they can be sent requests, the {anAgency} matches each of your
        credential requirements to its own. Either side can end a link at any time; both keep its history.
      </p>
      <Notices error={sp.error} done={sp.done} />
      {!canEdit && <div className="notice error">Only owners and administrators can link, reorder or end links.</div>}

      {newLink && (
        <div className="card" style={{ borderColor: 'var(--accent, #2563eb)' }}>
          <h2>Your new invitation link</h2>
          <p className="small">Send this to the {anAgency} (by email or message). It works once, for 7 days, and is shown only now.</p>
          <input readOnly value={newLink} style={{ width: '100%', fontFamily: 'monospace' }} aria-label="Invitation link" />
        </div>
      )}

      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>{tw.many(T.agency)} we use</h2>
        {weUse.length === 0 ? (
          <p className="muted">No {agencies} linked yet.{canEdit && ' Make an invitation link below.'}</p>
        ) : (
          <>
            <p className="muted small" style={{ marginTop: 0 }}>Requests go to the first {anAgency} straight away, then to each next one in this order on the timer below, until someone is put forward.</p>
            <table>
              <thead><tr><th>Order</th><th>{tw.one(T.agency)}</th><th>State</th><th>People they put forward</th><th /></tr></thead>
              <tbody>
                {weUse.map((l, i) => (
                  <tr key={l.connectionId}>
                    <td>
                      <b>{i + 1}</b>
                      {canEdit && weUse.length > 1 && (
                        <span style={{ marginLeft: 8 }}>
                          {i > 0 && <form action={moveAgency.bind(null, order, i, i - 1)} style={{ display: 'inline' }}><button className="btn small secondary" type="submit" aria-label={`Move ${l.otherName} up`}>↑</button></form>}
                          {i < weUse.length - 1 && <form action={moveAgency.bind(null, order, i, i + 1)} style={{ display: 'inline' }}><button className="btn small secondary" type="submit" aria-label={`Move ${l.otherName} down`}>↓</button></form>}
                        </span>
                      )}
                    </td>
                    <td><b>{l.otherName}</b><div className="muted small">Linked {when(l.createdAt)}</div></td>
                    <td className="small">{l.statusWords}</td>
                    <td>
                      {canEdit ? (
                        <form action={setBookMode.bind(null, l.connectionId)} style={{ display: 'flex', gap: 6 }}>
                          <select name="bookMode" defaultValue={l.bookMode} aria-label={`How people from ${l.otherName} are booked`}>
                            <option value="automatic">Booked straight away</option>
                            <option value="approve_first">We approve first</option>
                          </select>
                          <button className="btn small secondary" type="submit">Save</button>
                        </form>
                      ) : (l.bookMode === 'automatic' ? 'Booked straight away' : 'We approve first')}
                    </td>
                    <td>{canEdit && <EndForm link={l} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {(weUse.length > 0 || canEdit) && (
        <div className="card">
          <h2>How long each {anAgency} gets</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            When you send a {tw.lower(T.shift)} to your {agencies}, the first gets it straight away. If nobody has been put forward, the next one
            gets it too after this long, and so on down the list. The more urgent the {tw.lower(T.shift)}, the shorter the wait. You can choose a
            different time when sending one.
          </p>
          {canEdit ? (
            <form action={setTiming}>
              <div className="form-row" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {TIMING_BANDS.map(b => (
                  <label key={b.key}>{b.label}
                    <select name={b.key} defaultValue={String(timing[b.key])}>
                      {stepChoices(b.choices, timing[b.key]).map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <button type="submit" className="btn secondary">Save timing</button>
            </form>
          ) : (
            <ul className="small">
              {TIMING_BANDS.map(b => <li key={b.key}>{b.label}: {minutesWords(timing[b.key])}</li>)}
            </ul>
          )}
        </div>
      )}


      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>{tw.many(T.agency)} not on CROP</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          {tw.many(T.agency)} that don’t use CROP can still be asked. From a {tw.lower(T.shift)}’s panel on the roster you can email them the
          {' '}{tw.lower(T.shift)} with everything it needs: the standard requirements for the role and any special ones for that {tw.lower(T.shift)},
          each marked must have, ideal or optional. They reply to whoever sent it.
        </p>
        {outside.length === 0 ? <p className="muted">None added yet.</p> : (
          <table>
            <thead><tr><th>{tw.one(T.agency)}</th><th>Email</th><th>Emailed</th><th /></tr></thead>
            <tbody>
              {outside.map(a => (
                <tr key={a.id} style={a.active ? undefined : { opacity: 0.6 }}>
                  <td><b>{a.name}</b>{!a.active && <span className="muted small"> (switched off)</span>}
                    {a.phone && <div className="muted small">{a.phone}</div>}
                    {a.notes && <div className="muted small">{a.notes}</div>}
                  </td>
                  <td className="small">{a.email}</td>
                  <td className="small">{a.emailsSent === 0 ? 'Not yet' : `${a.emailsSent} ${a.emailsSent === 1 ? tw.lower(T.shift) : shifts}${a.lastSentAt ? `, last ${when(a.lastSentAt)}` : ''}`}</td>
                  <td>
                    {canEdit && (
                      <details>
                        <summary className="small">Change</summary>
                        <form action={saveOutsideAgency.bind(null, a.id)} style={{ marginTop: 6 }}>
                          <label className="small">Name<input name="name" defaultValue={a.name} maxLength={120} required /></label>
                          <label className="small">Email<input name="email" type="email" defaultValue={a.email} maxLength={200} required /></label>
                          <label className="small">Phone (optional)<input name="phone" defaultValue={a.phone ?? ''} maxLength={40} /></label>
                          <label className="small">Notes (optional)<input name="notes" defaultValue={a.notes ?? ''} maxLength={500} /></label>
                          <button className="btn small secondary" type="submit">Save</button>
                        </form>
                        <form action={switchOutsideAgency.bind(null, a.id, !a.active)} style={{ marginTop: 6 }}>
                          <button className="btn small secondary" type="submit">{a.active ? 'Switch off' : 'Switch on'}</button>
                        </form>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit && (
          <details style={{ marginTop: 12 }} open={outside.length === 0}>
            <summary className="small">Add {art(anAgency)} not on CROP</summary>
            <form action={addOutsideAgency} style={{ marginTop: 6 }}>
              <div className="form-row" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <label>Name<input name="name" maxLength={120} required /></label>
                <label>Email for {shifts}<input name="email" type="email" maxLength={200} required /></label>
                <label>Phone (optional)<input name="phone" maxLength={40} /></label>
              </div>
              <div className="form-row"><label>Notes (optional, for your office)<input name="notes" maxLength={500} /></label></div>
              <button type="submit" className="btn secondary">Add</button>
            </form>
          </details>
        )}
      </div>

      {canEdit && (
        <div className="card">
          <h2>Invite {art(anAgency)}</h2>
          <p className="muted small" style={{ marginTop: 0 }}>The {anAgency} needs its own CROP business. Whoever opens the link must be an owner or administrator there.</p>
          <form action={createInvite}>
            <div className="form-row">
              <label>Who it’s for (for your list; optional)
                <input name="forName" maxLength={120} placeholder={`e.g. the ${anAgency}’s name`} />
              </label>
            </div>
            <button type="submit" className="btn">Make an invitation link</button>
          </form>
          {pending.length > 0 && (
            <table style={{ marginTop: 12 }}>
              <thead><tr><th>Waiting invitations</th><th>Made</th><th>Works until</th><th /></tr></thead>
              <tbody>
                {pending.map(i => (
                  <tr key={i.id}>
                    <td>{i.forName ?? 'No name given'}</td>
                    <td className="small">{when(i.createdAt)}{i.createdByName ? ` by ${i.createdByName}` : ''}</td>
                    <td className="small">{when(i.expiresAt)}</td>
                    <td><form action={cancelInvite.bind(null, i.id)}><button className="btn small secondary" type="submit">Cancel</button></form></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {recent.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="small">Earlier invitations ({recent.length})</summary>
              <ul className="small">
                {recent.map(i => <li key={i.id}>{i.forName ?? 'No name given'}, {when(i.createdAt)}: {INVITE_STATE[i.state]}{i.acceptedBy ? ` by ${i.acceptedBy}` : ''}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      {weSupply.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <h2>Businesses we supply</h2>
          <p className="muted small" style={{ marginTop: 0 }}>Businesses that have linked with you as {art(anAgency)}.</p>
          <table>
            <thead><tr><th>Business</th><th>State</th><th /></tr></thead>
            <tbody>
              {weSupply.map(l => (
                <tr key={l.connectionId}>
                  <td><b>{l.otherName}</b><div className="muted small">Linked {when(l.createdAt)}</div></td>
                  <td className="small">
                    {l.statusWords}
                    <div><Link href={`/settings/agencies/${l.connectionId}`} className="btn small secondary" style={{ marginTop: 4 }}>
                      {l.status === 'active' ? 'Matches and who is ready' : 'Match requirements'}
                    </Link></div>
                  </td>
                  <td>{canEdit && <EndForm link={l} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ended.length > 0 && (
        <details className="card">
          <summary>Ended links ({ended.length})</summary>
          <ul className="small">
            {ended.map(l => (
              <li key={l.connectionId}>
                {l.otherName} ({l.side === 'employer' ? `${anAgency} we used` : 'a business we supplied'}): ended {l.endedAt ? when(l.endedAt) : ''}
                {l.endedBySide ? ` by ${l.endedBySide === l.side ? 'us' : l.otherName}` : ''}{l.endedByName && l.endedBySide === l.side ? ` (${l.endedByName})` : ''}
                {l.endReason ? `: ${l.endReason}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function EndForm({ link }: { link: LinkRow }) {
  return (
    <details>
      <summary className="small">End link</summary>
      <form action={endLink.bind(null, link.connectionId)} style={{ marginTop: 6 }}>
        <label className="small">Reason (optional; {link.otherName} sees it)
          <input name="reason" maxLength={300} />
        </label>
        <button className="btn small secondary" type="submit">End the link with {link.otherName}</button>
      </form>
    </details>
  );
}
