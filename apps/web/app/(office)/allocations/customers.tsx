import Link from 'next/link';
import { api } from '../../../lib/api';
import { currentAgency } from '../../../lib/current-user';
import { requestPageUrl, requestStatus } from '../../../lib/customer-request';
import { Badge } from '../../../lib/format';
import { T, type Words } from '../../../lib/terms';
import { acceptCustomer, declineCustomer, setRequestPage } from './actions';

type CustomerRequest = {
  id: string; businessName: string; contactName: string; email: string; phone: string | null; frequency: 'once' | 'repeat';
  line: string; place: string; notes: string | null; status: 'new' | 'accepted' | 'declined'; createdAt: string;
  decidedAt: string | null; decidedByName: string | null; decidedNote: string | null; clientId: string | null; clientName: string | null;
};
type List = { open: boolean; waiting: number; requests: CustomerRequest[] };
type Page = { open: boolean; intro: string | null; slug: string };

/**
 * New customers (David, 3 Nov, answer 4; migration 0089): what came in through the business's public "request staff"
 * page. Owners and admins accept (a new client with the contact saved, or a client the business already has) or
 * decline, and switch the page on or off. Nothing is booked from here: the office takes the order as usual.
 */
export async function CustomerRequests({ tw, when, all }: { tw: Words; when: (iso: string) => string; all: boolean }) {
  const [list, page, clients, agency] = await Promise.all([
    api<List>(`/customer-requests${all ? '?status=all' : ''}`).catch(() => null),
    api<Page>('/customer-request-page').catch(() => null),
    api<{ id: string; name: string; status: string }[]>('/clients').catch(() => []),
    currentAgency(),
  ]);
  const decides = agency?.role === 'owner' || agency?.role === 'admin';
  const appUrl = process.env.APP_URL ?? '';
  const client = tw.lower(T.client);
  const live = clients.filter(c => c.status !== 'inactive').sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="cust-reqs">
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Your request page</h2>
        {page?.open
          ? <p>On. New customers can ask for staff at {appUrl ? <a href={requestPageUrl(appUrl, page.slug)} target="_blank" rel="noreferrer">{requestPageUrl(appUrl, page.slug)}</a> : <code>/request/{page.slug}</code>}: put the link on your website or send it to them. Requests land here; nothing is booked until you take the order.</p>
          : <p className="muted">Off. When it’s on, new or occasional customers can ask for staff from a page of yours without signing in, and their requests land here.</p>}
        {decides && page && (
          <form action={setRequestPage} className="form-row">
            <label className="inline"><input type="checkbox" name="open" defaultChecked={page.open} /> Take requests from new customers</label>
            <label>Welcome line (optional)<input name="intro" maxLength={500} defaultValue={page.intro ?? ''} placeholder="e.g. Tell us who you need and we'll call you back within the hour." /></label>
            <button className="btn small" type="submit">Save</button>
          </form>
        )}
      </section>
      <div className="q-header" style={{ marginTop: 16 }}>
        <h2 style={{ margin: 0 }}>{all ? 'Requests from new customers' : `Waiting (${list?.waiting ?? 0})`}</h2>
        <Link className="btn small secondary" href={all ? '/allocations?view=customers' : '/allocations?view=customers&all=1'}>{all ? 'Only those waiting' : 'Show decided too (90 days)'}</Link>
      </div>
      {!list && <p className="muted">Requests can’t be shown right now.</p>}
      {list && !list.requests.length && <p className="muted">{all ? 'No requests in the last 90 days.' : 'Nothing waiting.'}</p>}
      {list?.requests.map(r => (
        <article key={r.id} className="cust-req">
          <h3>{r.businessName} <Badge label={requestStatus(r.status)} /> {r.frequency === 'repeat' && <span className="badge neutral">Will order again</span>}</h3>
          <p style={{ margin: '2px 0' }}><strong>{r.line}</strong></p>
          <p style={{ margin: '2px 0' }}>{r.place}</p>
          <p className="muted" style={{ margin: '2px 0' }}>
            {r.contactName} · <a href={`mailto:${r.email}`}>{r.email}</a>{r.phone && <> · <a href={`tel:${r.phone.replace(/[^+\d]/g, '')}`}>{r.phone}</a></>} · sent {when(r.createdAt)}
          </p>
          {r.notes && <p style={{ margin: '6px 0', whiteSpace: 'pre-wrap' }}>{r.notes}</p>}
          {r.status === 'accepted' && (
            <p className="muted small" style={{ margin: '4px 0' }}>Accepted by {r.decidedByName ?? 'the office'}{r.decidedAt && ` ${when(r.decidedAt)}`}{r.clientId && <> · <Link href={`/clients/${r.clientId}`}>{r.clientName}</Link></>}</p>
          )}
          {r.status === 'declined' && (
            <p className="muted small" style={{ margin: '4px 0' }}>Declined by {r.decidedByName ?? 'the office'}{r.decidedAt && ` ${when(r.decidedAt)}`}{r.decidedNote && `: ${r.decidedNote}`}</p>
          )}
          {r.status === 'new' && decides && (
            <div className="form-row">
              <form action={acceptCustomer.bind(null, r.id, r.businessName)} className="form-row" style={{ marginTop: 0 }}>
                <label>As
                  <select name="clientId" defaultValue={live.find(c => c.name.toLowerCase() === r.businessName.toLowerCase())?.id ?? ''}>
                    <option value="">A new {client}: {r.businessName}</option>
                    {live.map(c => <option key={c.id} value={c.id}>{c.name} (already a {client})</option>)}
                  </select>
                </label>
                <button className="btn small" type="submit">Accept</button>
              </form>
              <details>
                <summary className="btn small secondary">Decline</summary>
                <form action={declineCustomer.bind(null, r.id, r.businessName)} className="form-row">
                  <label>Note for your records (optional)<input name="note" maxLength={300} placeholder="e.g. Outside our area" /></label>
                  <button className="btn small secondary" type="submit">Decline request</button>
                </form>
              </details>
            </div>
          )}
          {r.status === 'new' && !decides && <p className="muted small" style={{ margin: '4px 0' }}>An owner or admin accepts or declines it.</p>}
        </article>
      ))}
      {list?.requests.some(r => r.status === 'accepted') && (
        <p className="muted small">After accepting, add the {tw.lower(T.site)} on the {client}’s page, then use + New order.</p>
      )}
    </div>
  );
}
