import { api } from '../../../lib/api';
import { businessSettings } from '../../../lib/business';
import { moneyFor } from '../../../lib/money';
import { currentAgency } from '../../../lib/current-user';
import { industryGroups, needsHeadings, type PackInfo } from '../../../lib/industry-groups';
import { T, words } from '../../../lib/terms';
import { Notices } from '../notices';
import { addItem, count, issue, receive, transfer } from './actions';

export const dynamic = 'force-dynamic';

type Item = { id: string; name: string; category: string; unit: string; sku: string | null; unitCostCents: number; chargeCents: number | null; tracksStock: boolean; reorderLevel: number | null; active: boolean; onHand: number; industries?: string[] };
type Stock = { itemId: string; facilityId: string; facilityName: string; onHand: number; low: boolean };
type Facility = { id: string; name: string; active: boolean };
type Worker = { id: string; firstName: string; lastName: string; preferredName?: string | null; status: string };
const CAT: Record<string, string> = { ppe: 'PPE', fuel: 'Fuel', sundries: 'Sundries', tools: 'Tools', other: 'Other' };
const q = (n: number) => (Math.round(n * 1000) / 1000).toString();

/** Items and consumables (backlog item 5): what's on hand at each site, receiving, issuing and stocktakes. */
export default async function ItemsPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const tw = await words();
  const [items, stock, sites, workers, agency, sp, packs] = await Promise.all([
    api<Item[]>('/items'), api<Stock[]>('/stock'), api<Facility[]>('/facilities'), api<Worker[]>('/workers').catch(() => [] as Worker[]), currentAgency(), searchParams,
    api<PackInfo[]>('/industry-packs').catch(() => [] as PackInfo[]),
  ]);
  const itemGroups = industryGroups(items, packs);
  const canAdmin = agency?.role === 'owner' || agency?.role === 'admin';
  const money = moneyFor((await businessSettings()).country);
  const activeSites = sites.filter(s => s.active);
  const people = workers.filter(w => w.status === 'active');
  const siteSelect = <select name="facilityId" required>{activeSites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>;
  const low = stock.filter(s => s.low);
  return (
    <>
      <h1>{tw.many(T.item)}</h1>
      <p className="muted">PPE, fuel, sundries and tools: stock at each {tw.lower(T.site)}, moving it between {tw.lower(T.site, true)}, what goes out to people and shifts, and what it costs. Every movement is kept; corrections are a stocktake, never an edit.</p>
      <Notices error={sp.error} done={sp.done} />
      {low.length > 0 && <div className="notice error">Low stock: {low.map(s => `${items.find(i => i.id === s.itemId)?.name} at ${s.facilityName} (${q(s.onHand)})`).join('; ')}.</div>}
      {canAdmin && (
        <details className="card" open={items.length === 0}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Add an item</summary>
          <form action={addItem} className="form-row" style={{ marginTop: 12 }}>
            <label>Name<input name="name" required maxLength={80} placeholder="e.g. Hi-vis vest" /></label>
            <label>Category<select name="category" defaultValue="ppe">{Object.entries(CAT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label>Unit<input name="unit" maxLength={20} defaultValue="each" /></label>
            <label>Cost each ($)<input name="unitCost" inputMode="decimal" placeholder="0.00" /></label>
            <label>Charge to client ($) <span className="muted">(optional)</span><input name="charge" inputMode="decimal" /></label>
            <label>Reorder at <span className="muted">(optional)</span><input name="reorderLevel" type="number" min={0} step="any" /></label>
            <label className="inline"><input type="checkbox" name="tracksStock" defaultChecked />Count stock</label>
            <button className="btn">Add item</button>
          </form>
        </details>
      )}
      <div className="card" style={{ overflowX: 'auto' }}>
        {items.length === 0 ? <p className="muted" style={{ margin: 0 }}>No items yet. Apply an industry template in Settings for a starter list.</p> : (
          <table>
            <thead><tr><th>Item</th><th>Cost</th><th>Charge</th><th>On hand</th><th>Record</th></tr></thead>
            <tbody>
              {itemGroups.map(g => [
                needsHeadings(itemGroups) && <tr key={`g-${g.key}`} className="grp-row"><th colSpan={5}>{g.label} <span className="muted">({g.items.length})</span></th></tr>,
                ...g.items.map(i => {
                const at = stock.filter(s => s.itemId === i.id);
                return (
                  <tr key={i.id}>
                    <td><strong>{i.name}</strong><div className="muted small">{CAT[i.category] ?? i.category} · per {i.unit}{i.sku ? ` · ${i.sku}` : ''}</div></td>
                    <td>{money(i.unitCostCents)}</td>
                    <td>{money(i.chargeCents)}</td>
                    <td>
                      {!i.tracksStock ? <span className="muted">Not counted</span> : at.length === 0 ? <span className="muted">None</span>
                        : at.map(s => <div key={s.facilityId} className={s.low ? 'bad-text' : ''}>{q(s.onHand)} <span className="muted small">at {s.facilityName}{s.low ? ' · low' : ''}</span></div>)}
                    </td>
                    <td>
                      {activeSites.length === 0 ? <span className="muted small">Add a site first</span> : (
                        <details>
                          <summary className="muted" style={{ cursor: 'pointer' }}>{i.tracksStock && activeSites.length > 1 ? 'Receive, issue, move, count' : 'Receive, issue, count'}</summary>
                          <div className="item-forms">
                            {i.tracksStock && (
                              <form action={receive.bind(null, i.id)} className="form-row">
                                <strong className="small">Received</strong>{siteSelect}
                                <input name="quantity" type="number" min={0} step="any" required placeholder={`How many (${i.unit})`} aria-label="Quantity received" />
                                <input name="unitCost" inputMode="decimal" placeholder="Cost each $ (optional)" aria-label="Cost each" />
                                <button className="btn small secondary">Receive</button>
                              </form>
                            )}
                            {people.length > 0 && (
                              <form action={issue.bind(null, i.id)} className="form-row">
                                <strong className="small">Issue to</strong>
                                <select name="workerId" required aria-label="Person">{people.map(w => <option key={w.id} value={w.id}>{w.preferredName ?? w.firstName} {w.lastName}</option>)}</select>
                                {i.tracksStock && siteSelect}
                                <input name="quantity" type="number" min={0} step="any" required placeholder="How many" aria-label="Quantity issued" />
                                <button className="btn small secondary">Issue</button>
                              </form>
                            )}
                            {i.tracksStock && activeSites.length > 1 && at.some(s => s.onHand > 0) && (
                              <form action={transfer.bind(null, i.id)} className="form-row">
                                <strong className="small">Move from</strong>
                                <select name="fromFacilityId" required aria-label={`${tw.one(T.site)} it leaves`} defaultValue={at.find(s => s.onHand > 0)?.facilityId}>
                                  {at.filter(s => s.onHand > 0).map(s => <option key={s.facilityId} value={s.facilityId}>{s.facilityName} ({q(s.onHand)})</option>)}
                                </select>
                                <span className="small">to</span>
                                <select name="toFacilityId" required aria-label={`${tw.one(T.site)} it goes to`} defaultValue={activeSites.find(s => s.id !== at.find(x => x.onHand > 0)?.facilityId)?.id}>
                                  {activeSites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                                <input name="quantity" type="number" min={0} step="any" required placeholder="How many" aria-label="Quantity moved" />
                                <button className="btn small secondary">Move</button>
                              </form>
                            )}
                            {i.tracksStock && canAdmin && (
                              <form action={count.bind(null, i.id)} className="form-row">
                                <strong className="small">Stocktake</strong>{siteSelect}
                                <input name="quantity" type="number" min={0} step="any" required placeholder="Counted" aria-label="Quantity counted" />
                                <button className="btn small secondary">Record count</button>
                              </form>
                            )}
                          </div>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              }),
              ])}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
