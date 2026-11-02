import Link from 'next/link';
import type { Words } from '../../../lib/terms';
import { T } from '../../../lib/terms';
import { CHANNELS, type PlaceGroup } from '../../../lib/client-orders';
import { createClientOrder } from './actions';

export type ClientOrder = {
  id: string; clientName: string; facilityName: string; channelWords: string; requestedByName: string; requestedByEmail: string | null; requestedByPhone: string | null;
  clientReference: string | null; notes: string | null; confirmToClient: boolean; createdAt: string; firstLocalDate: string | null; lastLocalDate: string | null;
  total: number; summary: string; confirmationsSent: number;
};

const shortDay = (d: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`)).replace(',', '');

/**
 * New order (client orders, 2 Nov): what a client asked for by email, phone or their portal. Opened from Allocations'
 * "+ New order" button.
 */
export function NewOrderForm({ tw, places, roles, today }: { tw: Words; places: PlaceGroup[]; roles: string[]; today: string }) {
  const shift = tw.lower(T.shift), shifts = tw.lower(T.shift, true), client = tw.lower(T.client);
  return (
    <div className="card client-order">
        <h2>New order</h2>
        <p className="muted small">Type in what a {client} asked for by email, phone or their portal. Each person wanted is a {shift} on the roster, linked to this order. When one is booked, the person who asked can be emailed who is going.</p>
        {places.length === 0 ? (
          <p className="muted">Give a {tw.lower(T.site)} a {client} first, under <Link href="/facilities">{tw.many(T.site)}</Link>.</p>
        ) : (
          <form action={createClientOrder} className="form-row" style={{ marginTop: 8 }}>
            <label style={{ flex: '2 1 280px' }}>{tw.one(T.client)} · {tw.one(T.site)}
              <select name="place" required defaultValue="">
                <option value="" disabled>Choose…</option>
                {places.map(g => (
                  <optgroup key={g.clientName} label={g.clientName}>
                    {g.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>{tw.one(T.role)}
              <input name="role" required maxLength={60} list="order-roles" placeholder="e.g. Registered Nurse" />
              <datalist id="order-roles">{roles.map(r => <option key={r} value={r} />)}</datalist>
            </label>
            <label style={{ flex: '0 1 150px' }}>Date<input name="startDate" type="date" required defaultValue={today} min={today} /></label>
            <label style={{ flex: '0 1 170px' }}>Until <span className="muted">(optional)</span><input name="endDate" type="date" min={today} /></label>
            <label style={{ flex: '0 1 110px' }}>Start<input name="startTime" type="time" required /></label>
            <label style={{ flex: '0 1 110px' }}>End<input name="endTime" type="time" required /></label>
            <label style={{ flex: '0 1 110px' }}>Break (min)<input name="breakMinutes" type="number" min={0} max={240} defaultValue={0} /></label>
            <label style={{ flex: '0 1 100px' }}>People<input name="quantity" type="number" min={1} max={20} defaultValue={1} /></label>
            <fieldset className="weekdays">
              <legend>Days <span className="muted">(optional: only these days, in the week from the date or up to Until)</span></legend>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => (
                <label key={d} className="inline"><input type="checkbox" name="weekdays" value={i + 1} />{d}</label>
              ))}
            </fieldset>
            <label style={{ flex: '0 1 160px' }}>Gender requested
              <select name="genderRequested" defaultValue="">
                <option value="">No preference</option>
                <option value="F">Female (F)</option>
                <option value="M">Male (M)</option>
              </select>
            </label>
            <label style={{ flex: '2 1 280px' }}>Note on the {shifts} <span className="muted">(optional)</span><input name="notes" maxLength={1000} /></label>
            <fieldset className="weekdays client-order-who">
              <legend>Who asked</legend>
              <label>Name<input name="requestedByName" required maxLength={120} /></label>
              <label>Email <span className="muted">(for the booked email)</span><input name="requestedByEmail" type="email" maxLength={200} /></label>
              <label>Phone <span className="muted">(optional)</span><input name="requestedByPhone" maxLength={40} /></label>
              <label style={{ flex: '0 1 130px' }}>How
                <select name="channel" defaultValue="email">{CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
              </label>
              <label style={{ flex: '0 1 160px' }}>Their reference <span className="muted">(optional)</span><input name="clientReference" maxLength={60} /></label>
              <label style={{ flex: '2 1 280px' }}>Order notes <span className="muted">(optional, for the office)</span><input name="orderNotes" maxLength={1000} /></label>
            </fieldset>
            <label className="inline" style={{ flex: '1 1 100%' }}>
              <input type="checkbox" name="confirmToClient" defaultChecked />Email the {client} when filled (the person&apos;s name, {tw.lower(T.role)} and the {shift})
            </label>
            <button type="submit" className="btn">Save order</button>
          </form>
        )}
      </div>
  );
}

/** Recent orders with how many of their shifts are filled: Allocations' "Completed and history". */
export function RecentOrders({ tw, orders, when }: { tw: Words; orders: ClientOrder[]; when: (iso: string) => string }) {
  if (!orders.length) return <p className="muted">No orders in the last 30 days.</p>;
  return (
    <>
        <div className="card" style={{ overflowX: 'auto' }}>
          <h2>Recent orders</h2>
          <table>
            <thead><tr><th>Taken</th><th>{tw.one(T.client)} · {tw.one(T.site)}</th><th>Who asked</th><th>{tw.many(T.shift)}</th><th>Filled</th></tr></thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id}>
                  <td>{when(o.createdAt)}</td>
                  <td>{o.clientName} · {o.facilityName}</td>
                  <td>
                    {o.requestedByName} <span className="muted">· {o.channelWords}{o.clientReference ? ` · ref ${o.clientReference}` : ''}</span>
                    {o.requestedByEmail && <div className="muted small">{o.requestedByEmail}{o.confirmToClient ? '' : ' (not emailed)'}</div>}
                  </td>
                  <td>{o.firstLocalDate ? (o.lastLocalDate && o.lastLocalDate !== o.firstLocalDate ? `${shortDay(o.firstLocalDate)} to ${shortDay(o.lastLocalDate)}` : shortDay(o.firstLocalDate)) : '–'}
                    <span className="muted"> · {tw.count(o.total, T.shift)}</span></td>
                  <td>{o.summary}{o.confirmationsSent > 0 && <div className="muted small">{o.confirmationsSent} booked {o.confirmationsSent === 1 ? 'email' : 'emails'} sent</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
    </>
  );
}
