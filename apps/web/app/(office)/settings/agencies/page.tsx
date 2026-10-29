import { cookies } from 'next/headers';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { whenIn, businessZone } from '../../../../lib/business';
import { currentAgency } from '../../../../lib/current-user';
import { T, words } from '../../../../lib/terms';
import { Notices } from '../../notices';
import { cancelInvite, createInvite, endLink, moveAgency, setBookMode } from './actions';
import { NEW_LINK_COOKIE } from './invite-cookie';

export const dynamic = 'force-dynamic';

type LinkRow = {
  connectionId: string; side: 'employer' | 'agency'; otherName: string; status: 'matching' | 'active' | 'ended'; statusWords: string;
  preference: number | null; bookMode: 'automatic' | 'approve_first'; createdAt: string; endedAt: string | null;
  endedByName: string | null; endedBySide: 'employer' | 'agency' | null; endReason: string | null;
};
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
  const [data, agency, sp, zone] = await Promise.all([
    api<{ links: LinkRow[]; invitations: Invite[] }>('/agency-links'), currentAgency(), searchParams, businessZone(),
  ]);
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
            <p className="muted small" style={{ marginTop: 0 }}>Requests go to the first {anAgency}, then the next ones on a timer (from agency fill, coming soon).</p>
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
                      {l.status === 'active' ? 'See matches' : 'Match requirements'}
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
