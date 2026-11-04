import { addressTitle, earlierLine, noCurrentLine, type Address, type Addresses } from '../../../../lib/addresses';
import { COUNTRIES, STATES, US_STATES } from '../../../../lib/places';
import { addAddress, correctAddress, makeAddressCurrent, removeAddress } from './address-actions';

/** The address form's fields (add and correct). Australian and US states come as suggestions; the API checks them. */
function AddressFields({ a, homeCountry, listId }: { a?: Address; homeCountry: string; listId: string }) {
  return (
    <>
      <label>Name <span className="muted">(optional)</span><input name="label" defaultValue={a?.label ?? ''} maxLength={40} placeholder="e.g. Home, Postal" /></label>
      <label>Street address<input name="line1" required defaultValue={a?.line1 ?? ''} maxLength={200} autoComplete="off" /></label>
      <label>Second line <span className="muted">(optional)</span><input name="line2" defaultValue={a?.line2 ?? ''} maxLength={200} autoComplete="off" /></label>
      <label>Suburb or town<input name="suburb" defaultValue={a?.suburb ?? ''} maxLength={100} autoComplete="off" /></label>
      <label>State or region
        <input name="state" defaultValue={a?.region ?? ''} maxLength={60} list={listId} />
        <datalist id={listId}>{[...STATES, ...US_STATES].map(s => <option key={s} value={s} />)}</datalist>
      </label>
      <label>Postcode<input name="postcode" defaultValue={a?.postcode ?? ''} maxLength={10} autoComplete="off" /></label>
      <label>Country
        <select name="country" defaultValue={a?.country ?? homeCountry}>
          {Object.entries(COUNTRIES).map(([k, c]) => <option key={k} value={k}>{c.name}</option>)}
        </select>
      </label>
    </>
  );
}

/** Correct or take off the list: both keep the old version on file. */
function Changes({ workerId, a, homeCountry }: { workerId: string; a: Address; homeCountry: string }) {
  return (
    <>
      <details style={{ marginTop: 6 }}>
        <summary className="muted" style={{ cursor: 'pointer' }}>Correct a mistake</summary>
        <form action={correctAddress.bind(null, workerId, a.id)} className="form-row" style={{ marginTop: 8 }}>
          <AddressFields a={a} homeCountry={homeCountry} listId={`regions-${a.id}`} />
          <button type="submit" className="btn small">Save correction</button>
        </form>
        <p className="muted small">The address as it was is kept in its history.</p>
      </details>
      <details style={{ marginTop: 6 }}>
        <summary className="muted" style={{ cursor: 'pointer' }}>Take off the list</summary>
        <form action={removeAddress.bind(null, workerId, a.id)} className="form-row" style={{ marginTop: 8 }}>
          <label>Why <span className="muted">(optional)</span><input name="reason" maxLength={200} placeholder="e.g. Moved out" /></label>
          <button type="submit" className="btn small secondary">Take off the list</button>
        </form>
      </details>
    </>
  );
}

/**
 * A person's addresses (David, 3 Nov 2026, answer 5): several, one of them current; nothing is ever overwritten.
 * Earlier versions (corrected or taken off the list) are listed underneath.
 */
export function AddressesCard({ workerId, a, homeCountry, when }: {
  workerId: string; a: Addresses; homeCountry: string; when: (iso: string) => string;
}) {
  return (
    <div className="card">
      <h2>Addresses</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Office only. A person can have several addresses with one current; nothing is overwritten, so earlier addresses and corrections stay on file.
      </p>
      {a.current ? (
        <div className="address current">
          <strong>Current</strong> <span>{addressTitle(a.current)}</span>
          <Changes workerId={workerId} a={a.current} homeCountry={homeCountry} />
        </div>
      ) : <p className="muted">{noCurrentLine(a.others.length)}</p>}
      {a.others.length > 0 && (
        <>
          <h3 style={{ marginBottom: 4 }}>Other addresses</h3>
          <ul className="compact" style={{ paddingLeft: 18 }}>
            {a.others.map(o => (
              <li key={o.id} style={{ marginBottom: 8 }}>
                {addressTitle(o)}{' '}
                <form action={makeAddressCurrent.bind(null, workerId, o.id)} style={{ display: 'inline' }}>
                  <button type="submit" className="btn small secondary">Make current</button>
                </form>
                <Changes workerId={workerId} a={o} homeCountry={homeCountry} />
              </li>
            ))}
          </ul>
        </>
      )}
      <details style={{ marginTop: 12 }} open={!a.current && a.others.length === 0}>
        <summary style={{ cursor: 'pointer' }}>Add an address</summary>
        <form action={addAddress.bind(null, workerId)} className="form-row" style={{ marginTop: 8 }}>
          <AddressFields homeCountry={homeCountry} listId="regions-new" />
          {(a.current || a.others.length > 0) && <label className="inline"><input type="checkbox" name="current" /> Make it the current address</label>}
          <button type="submit" className="btn small">Add address</button>
        </form>
      </details>
      {a.earlier.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary className="muted" style={{ cursor: 'pointer' }}>Earlier versions ({a.earlier.length})</summary>
          <ul className="compact" style={{ paddingLeft: 18 }}>
            {a.earlier.map(e => (
              <li key={e.id}>{addressTitle(e)} <span className="muted small">· {earlierLine(e, when)}</span></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
