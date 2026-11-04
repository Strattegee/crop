import Link from 'next/link';
import { api } from '../../../lib/api';
import { currentAgency } from '../../../lib/current-user';
import { businessSettings, todayIn } from '../../../lib/business';
import { needsOrder, orderTakenLine, placeLabels, regionFor, requestPageUrl, requestStatus } from '../../../lib/customer-request';
import { Badge } from '../../../lib/format';
import { T, type Words } from '../../../lib/terms';
import { acceptCustomer, declineCustomer, orderFromRequest, setRequestPage } from './actions';

type CustomerRequest = {
  id: string; businessName: string; contactName: string; email: string; phone: string | null; frequency: 'once' | 'repeat';
  line: string; place: string; notes: string | null; status: 'new' | 'accepted' | 'declined'; createdAt: string;
  decidedAt: string | null; decidedByName: string | null; decidedNote: string | null; clientId: string | null; clientName: string | null;
  role: string; date: string; startTime: string; endTime: string; people: number;
  siteName: string | null; address: string; suburb: string | null; region: string | null; postcode: string | null;
  orderId: string | null; orderFacilityId: string | null; orderShifts: number | null;
};
type Site = { id: string; name: string; clientId: string | null; active: boolean; areas?: { id: string; name: string; active: boolean }[] };
type List = { open: boolean; waiting: number; requests: CustomerRequest[] };
type Page = { open: boolean; intro: string | null; slug: string };

/**
 * New customers (David, 3 Nov, answer 4; migration 0089): what came in through the business's public "request staff"
 * page. Owners and admins accept (a new client with the contact saved, or a client the business already has) or
 * decline, and switch the page on or off. Nothing is booked from here: the office takes the order as usual.
 */
export async function CustomerRequests({ tw, when, all }: { tw: Words; when: (iso: string) => string; all: boolean }) {
  const [list, page, clients, agency, sites, roles, settings] = await Promise.all([
    api<List>(`/customer-requests${all ? '?status=all' : ''}`).catch(() => null),
    api<Page>('/customer-request-page').catch(() => null),
    api<{ id: string; name: string; status: string }[]>('/clients').catch(() => []),
    currentAgency(),
    api<Site[]>('/facilities').catch(() => [] as Site[]),
    api<{ name: string; active?: boolean }[]>('/roles').catch(() => []),
    businessSettings(),
  ]);
  // Areas only for the sites of clients with an order still to take (a handful).
  const ordering = new Set((list?.requests ?? []).filter(needsOrder).map(r => r.clientId));
  const clientSites = await Promise.all(sites.filter(f => f.active && f.clientId && ordering.has(f.clientId)).slice(0, 40).map(async f =>
    ({ ...f, areas: (await api<{ areas: Site['areas'] }>(`/facilities/${f.id}`).catch(() => ({ areas: [] }))).areas ?? [] })));
  const siteName = (id: string | null) => sites.find(f => f.id === id)?.name ?? null;
  const roleNames = [...new Set(roles.filter(r => r.active !== false).map(r => r.name))].sort();
  const country = settings.country ?? 'AU';
  const today = todayIn(settings.timezone ?? 'Australia/Melbourne');
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
          {r.status === 'accepted' && r.orderId && (
            <p className="small" style={{ margin: '4px 0' }}>
              {orderTakenLine(r, siteName(r.orderFacilityId), n => tw.count(n, T.shift))} · <Link href={`/allocations?clientId=${r.clientId}`}>See them in the queue</Link>
            </p>
          )}
          {needsOrder(r) && r.clientId && (
            <TakeOrder r={r} tw={tw} sites={clientSites.filter(f => f.clientId === r.clientId)} roles={roleNames} canAddSite={decides} country={country} today={today} />
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
    </div>
  );
}

/**
 * "Take the order" on an accepted request (migration 0091): everything filled in from what the customer sent, at one of
 * the client's sites (or area) or, for owners and admins, a new site from the address they gave. Saves the order and
 * its shifts in one go; the request then shows its order and can't make another.
 */
function TakeOrder({ r, tw, sites, roles, canAddSite, country, today }: {
  r: CustomerRequest; tw: Words; sites: Site[]; roles: string[]; canAddSite: boolean; country: string; today: string;
}) {
  const site = tw.lower(T.site), client = tw.lower(T.client), shifts = tw.lower(T.shift, true);
  const labels = placeLabels(country);
  const live = sites.filter(f => f.active);
  if (!live.length && !canAddSite) {
    return <p className="muted small" style={{ margin: '4px 0' }}>To take the order, an owner or admin adds the {site} on the <Link href={`/clients/${r.clientId}`}>{client}’s page</Link> first.</p>;
  }
  const newName = r.siteName ?? r.businessName;
  return (
    <details className="take-order" open={!live.length}>
      <summary className="btn small">Take the order</summary>
      <form action={orderFromRequest.bind(null, r.id, r.clientId!)} className="form-row">
        <label style={{ flex: '2 1 260px' }}>{tw.one(T.site)}
          <select name="site" required defaultValue={live.length ? live[0].id : 'new'}>
            {live.map(f => [
              <option key={f.id} value={f.id}>{f.name}</option>,
              ...(f.areas ?? []).filter(a => a.active).map(a => <option key={a.id} value={`${f.id}|${a.id}`}>{f.name} · {a.name}</option>),
            ])}
            {canAddSite && <option value="new">A new {site}: {newName}, {r.address}</option>}
          </select>
        </label>
        {canAddSite && (
          <fieldset className="new-site">
            <legend>New {site} <span className="muted">(only used when “A new {site}” is chosen; check the address)</span></legend>
            <label>Name<input name="siteName" maxLength={200} defaultValue={newName} /></label>
            <label style={{ flex: '2 1 240px' }}>Street address<input name="addressLine" maxLength={200} defaultValue={r.address} /></label>
            <label>{labels.suburb}<input name="suburb" maxLength={100} defaultValue={r.suburb ?? ''} /></label>
            <label style={{ flex: '0 1 140px' }}>{labels.region}<input name="state" maxLength={60} defaultValue={regionFor(country, r.region)} /></label>
            <label style={{ flex: '0 1 120px' }}>{labels.postcode}<input name="postcode" maxLength={10} defaultValue={r.postcode ?? ''} /></label>
          </fieldset>
        )}
        <label>{tw.one(T.role)}
          <input name="role" required maxLength={60} list={`roles-${r.id}`} defaultValue={r.role} />
          <datalist id={`roles-${r.id}`}>{roles.map(x => <option key={x} value={x} />)}</datalist>
        </label>
        <label style={{ flex: '0 1 150px' }}>Date<input name="date" type="date" required defaultValue={r.date} min={today} /></label>
        <label style={{ flex: '0 1 110px' }}>Start<input name="startTime" type="time" required defaultValue={r.startTime} /></label>
        <label style={{ flex: '0 1 110px' }}>End<input name="endTime" type="time" required defaultValue={r.endTime} /></label>
        <label style={{ flex: '0 1 110px' }}>Break (min)<input name="breakMinutes" type="number" min={0} max={240} defaultValue={0} /></label>
        <label style={{ flex: '0 1 100px' }}>People<input name="quantity" type="number" min={1} max={20} defaultValue={r.people} /></label>
        <label style={{ flex: '2 1 280px' }}>Order notes <span className="muted">(for the office)</span><input name="orderNotes" maxLength={1000} defaultValue={r.notes ?? ''} /></label>
        <input type="hidden" name="requestedByName" value={r.contactName} />
        <input type="hidden" name="requestedByEmail" value={r.email} />
        {r.phone && <input type="hidden" name="requestedByPhone" value={r.phone} />}
        <label className="inline" style={{ flex: '1 1 100%' }}>
          <input type="checkbox" name="confirmToClient" defaultChecked />Email {r.contactName} when filled (the person&apos;s name, {tw.lower(T.role)} and the {tw.lower(T.shift)})
        </label>
        <button type="submit" className="btn">Save order and add the {shifts}</button>
      </form>
    </details>
  );
}
