import Link from 'next/link';
import { api } from '../../../lib/api';
import { Notices } from '../notices';
import { T, words } from '../../../lib/terms';
import {
  assign, bookEquipment, cancelShift, confirm, createShifts, fillWeekDemo, loadDemoWeek, offer, recordReply, removeEquipment, unassign,
} from './actions';

export const dynamic = 'force-dynamic';

type Shift = {
  id: string; facilityId: string; facilityName: string; areaId: string | null; areaName: string | null; shiftCode: string | null;
  role: string; status: 'open' | 'assigned' | 'booked' | 'cancelled'; localDate: string; localStart: string; localEnd: string; hours: number;
  workerId: string | null; workerName: string | null; assignmentStatus: string | null; notes: string | null;
  equipmentOnly?: boolean; equipment?: { id: string; name: string; typeName: string }[];
};
type Person = { id: string; name: string; roles: string[]; employmentType: string | null; contractedHours: number | null; rosteredHours: number };
type Equip = { id: string; name: string; typeName: string; status: string; bookedHours: number };
type Roster = { from: string; to: string; shifts: Shift[]; people: Person[]; equipment?: Equip[] };
type Facility = { id: string; name: string; active: boolean };
type FacilityDetail = Facility & { areas: { id: string; name: string; active: boolean }[] };
type ShiftCode = { id: string; facilityId: string | null; facilityName: string | null; code: string; name: string | null; startTime: string; endTime: string; active: boolean };
type Reason = { code: string; message: string };
type Candidate = { workerId: string; name: string; employmentType: string | null; weekHours: number; eligible: boolean; blocks: Reason[]; warnings: Reason[]; offer?: { id: string; status: string } | null };
type Offer = { id: string; workerId: string; workerName?: string; name?: string; status: string; respondedVia?: string | null };
type EquipCandidate = { equipmentId: string; name: string; typeName: string; eligible: boolean; blocks: Reason[]; warnings: Reason[] };

const TYPE_SHORT: Record<string, string> = { full_time: 'Full-time', part_time: 'Part-time', casual: 'Casual', bank: 'Bank' };
const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: 'Open', cls: 'open' }, assigned: { label: 'Assigned', cls: 'assigned' }, booked: { label: 'Booked', cls: 'booked' },
};
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY));
function mondayOf(d: string) {
  const wd = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(d, -wd);
}
function todayMelbourne() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' }).format(new Date());
}
const dayLabel = (d: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const longDate = (d: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
/** AM, PM or night, from the local start time, for the colour band on a card. */
function band(s: Shift) {
  const h = Number(s.localStart.slice(0, 2));
  if (h >= 19 || h < 4) return 'nd';
  return h < 12 ? 'am' : 'pm';
}
const fmtHours = (n: number) => (Math.round(n * 10) / 10).toString();

export default async function RosterPage({ searchParams }: {
  searchParams: Promise<{ week?: string; site?: string; view?: string; shift?: string; error?: string; done?: string }>;
}) {
  const tw = await words();
  const sp = await searchParams;
  const today = todayMelbourne();
  const week = mondayOf(/^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? '') ? sp.week! : today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const view = sp.view === 'person' ? 'person' : 'area';
  const site = sp.site && /^[0-9a-f-]{36}$/i.test(sp.site) ? sp.site : '';
  const url = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { week, site, view, shift: sp.shift, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/roster?${p.toString()}`;
  };
  const here = url({});

  const [roster, facilities, codes] = await Promise.all([
    api<Roster>(`/roster?from=${days[0]}&to=${days[6]}${site ? `&facilityId=${site}` : ''}`),
    api<Facility[]>('/facilities'),
    api<ShiftCode[]>('/shift-codes'),
  ]);
  const activeFacilities = facilities.filter(f => f.active);
  const details = await Promise.all(activeFacilities.slice(0, 30).map(f => api<FacilityDetail>(`/facilities/${f.id}`)));
  const shifts = roster.shifts;
  const equipment = roster.equipment ?? [];
  const selected = sp.shift ? shifts.find(s => s.id === sp.shift) : undefined;

  // Summary
  const peopleShifts = shifts.filter(s => !s.equipmentOnly);
  const filled = peopleShifts.filter(s => s.status !== 'open').length;
  const open = peopleShifts.length - filled;
  const hours = peopleShifts.filter(s => s.status !== 'open').reduce((a, s) => a + s.hours, 0);
  const equipHours = equipment.reduce((a, e) => a + e.bookedHours, 0);

  // Rows
  type Row = { key: string; label: string; sub?: string; kind: 'person' | 'open' | 'equipment'; cells: Shift[][]; balance?: { text: string; cls: string } };
  const cellsFor = (pred: (s: Shift) => boolean, list: Shift[]) => days.map(d => list.filter(s => s.localDate === d && pred(s)));
  const personRow = (p: Person, list: Shift[]): Row => {
    const bal = p.contractedHours == null ? null : p.contractedHours - p.rosteredHours;
    return {
      key: p.id, label: p.name, kind: 'person',
      sub: [p.employmentType ? TYPE_SHORT[p.employmentType] : null, p.roles.join(', ') || null].filter(Boolean).join(' · '),
      cells: cellsFor(s => s.workerId === p.id, list),
      balance: { text: `${fmtHours(p.rosteredHours)}${p.contractedHours != null ? ` / ${fmtHours(p.contractedHours)}` : ''} h`, cls: bal == null ? '' : bal < 0 ? 'over' : bal === 0 ? 'even' : 'under' },
    };
  };
  const openRow = (key: string, list: Shift[]): Row => ({
    key: `open-${key}`, label: 'Open shifts', kind: 'open', sub: `${list.filter(s => !s.workerId && !s.equipmentOnly).length} to fill`,
    cells: cellsFor(s => !s.workerId && !s.equipmentOnly, list),
  });
  const equipOnlyRow = (key: string, list: Shift[]): Row | null => list.some(s => s.equipmentOnly)
    ? { key: `eq-${key}`, label: 'Equipment only', kind: 'equipment', sub: 'dry hire', cells: cellsFor(s => !!s.equipmentOnly, list) }
    : null;

  const groups: { key: string; title: string; sub?: string; rows: Row[] }[] = [];
  if (view === 'area') {
    const byGroup = new Map<string, Shift[]>();
    for (const s of shifts) {
      const k = `${s.facilityName}|||${s.areaName ?? ''}`;
      byGroup.set(k, [...(byGroup.get(k) ?? []), s]);
    }
    for (const [k, list] of [...byGroup.entries()].sort()) {
      const [fac, area] = k.split('|||');
      const people = roster.people.filter(p => list.some(s => s.workerId === p.id));
      const rows = [...people.map(p => personRow(p, list))];
      if (list.some(s => !s.workerId && !s.equipmentOnly)) rows.push(openRow(k, list));
      const eq = equipOnlyRow(k, list);
      if (eq) rows.push(eq);
      groups.push({ key: k, title: fac, sub: area || 'No area', rows });
    }
  } else {
    groups.push({ key: 'people', title: 'People', rows: [...roster.people.map(p => personRow(p, shifts)), openRow('all', shifts)] });
  }
  if (equipment.length) {
    groups.push({
      key: 'equipment', title: 'Equipment', sub: `${fmtHours(equipHours)} hours booked`,
      rows: equipment.map(e => ({
        key: e.id, label: e.name, sub: `${e.typeName}${e.status !== 'active' ? ' · out of service' : ''}`, kind: 'equipment' as const,
        cells: cellsFor(s => !!s.equipment?.some(x => x.id === e.id), shifts),
        balance: { text: `${fmtHours(e.bookedHours)} h`, cls: '' },
      })),
    });
  }

  // Selected shift panel data
  let candidates: Candidate[] = [];
  let offers: Offer[] = [];
  let equipCandidates: EquipCandidate[] = [];
  let panelError: string | null = null;
  if (selected) {
    try {
      const [bank, all, eq] = await Promise.all([
        api<{ candidates: Candidate[]; offers: Offer[] }>(`/shifts/${selected.id}/bank-fill`),
        api<{ candidates: Candidate[] }>(`/shifts/${selected.id}/candidates`),
        api<{ candidates: EquipCandidate[] }>(`/shifts/${selected.id}/equipment-candidates`),
      ]);
      offers = bank.offers;
      const bankIds = new Set(bank.candidates.map(c => c.workerId));
      candidates = all.candidates.map(c => ({ ...c, offer: bank.candidates.find(b => b.workerId === c.workerId)?.offer ?? null, employmentType: c.employmentType }))
        .map(c => ({ ...c, bank: bankIds.has(c.workerId) }));
      equipCandidates = eq.candidates;
    } catch {
      panelError = 'Could not load the details for this shift.';
    }
  }
  const bankReady = candidates.filter(c => c.eligible && ['bank', 'casual'].includes(c.employmentType ?? '') && !c.offer);
  const pendingOffers = offers.filter(o => o.status === 'pending');
  const declinedOffers = offers.filter(o => o.status === 'declined');

  return (
    <div className="roster-page">
      <div className="roster-head">
        <div>
          <h1>{tw.one(T.roster)}</h1>
          <p className="muted" style={{ margin: 0 }}>Week of {longDate(days[0])} – {longDate(days[6])}</p>
        </div>
        <div className="roster-tools">
          <Link className="btn small secondary" href={url({ week: addDays(week, -7), shift: undefined })} aria-label="Previous week">‹</Link>
          <Link className="btn small secondary" href={url({ week: mondayOf(today), shift: undefined })}>This week</Link>
          <Link className="btn small secondary" href={url({ week: addDays(week, 7), shift: undefined })} aria-label="Next week">›</Link>
          <form method="get" action="/roster" className="roster-tools">
            <input type="hidden" name="week" value={week} />
            <input type="hidden" name="view" value={view} />
            <label className="inline">Site
              <select name="site" defaultValue={site}>
                <option value="">All sites</option>
                {activeFacilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <button type="submit" className="btn small secondary">Show</button>
          </form>
          <div className="seg" role="group" aria-label="View">
            <Link href={url({ view: 'area' })} aria-current={view === 'area' ? 'true' : undefined}>By area</Link>
            <Link href={url({ view: 'person' })} aria-current={view === 'person' ? 'true' : undefined}>By person</Link>
          </div>
        </div>
      </div>

      <Notices error={sp.error} done={sp.done} />

      <section className="roster-kpis" aria-label="Week summary">
        <div><span>Shifts</span><strong>{peopleShifts.length}</strong></div>
        <div><span>Filled</span><strong className="ok">{filled}</strong></div>
        <div><span>Open</span><strong className={open ? 'warn' : ''}>{open}</strong></div>
        <div><span>Hours rostered</span><strong>{fmtHours(hours)}</strong></div>
        <div><span>Equipment hours</span><strong>{fmtHours(equipHours)}</strong></div>
      </section>

      {process.env.DEMO_TOOLS === 'on' && shifts.length === 0 && roster.people.length === 0 && (
        <form action={loadDemoWeek} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="hidden" name="back" value={here} />
          <input type="hidden" name="week" value={week} />
          <span>This business is empty. Load <strong>The Grand Café</strong>, an invented demo: 32 staff in 15 roles, their certificates (a few expired or missing on purpose), equipment, stock and a week of shifts. It takes about a minute.</span>
          <button className="btn small">Load café demo</button>
        </form>
      )}

      {process.env.DEMO_TOOLS === 'on' && open > 0 && (
        <form action={fillWeekDemo} className="roster-tools" style={{ justifyContent: 'flex-end' }}>
          <input type="hidden" name="back" value={here} />
          <input type="hidden" name="week" value={week} />
          <span className="muted small">Demo only:</span>
          <button className="btn small secondary">Fill open shifts with demo staff</button>
        </form>
      )}

      <details className="card" open={shifts.length === 0}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Add shifts</summary>
        {activeFacilities.length === 0 ? (
          <p className="muted">Add a site first, under <Link href="/facilities">Facilities</Link>.</p>
        ) : (
          <form action={createShifts} className="form-row" style={{ marginTop: 12 }}>
            <input type="hidden" name="back" value={here} />
            <label>Site
              <select name="facilityId" required defaultValue={site || activeFacilities[0]?.id}>
                {activeFacilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label>Area <span className="muted">(optional)</span>
              <select name="areaId" defaultValue="">
                <option value="">No area</option>
                {details.flatMap(d => d.areas.filter(a => a.active).map(a => <option key={a.id} value={a.id}>{d.name} · {a.name}</option>))}
              </select>
            </label>
            <label>Role
              <input name="role" placeholder="e.g. Barista" maxLength={60} list="known-roles" />
              <datalist id="known-roles">
                {[...new Set(roster.people.flatMap(p => p.roles))].sort().map(r => <option key={r} value={r} />)}
              </datalist>
            </label>
            <label>Shift code
              <select name="shiftCodeId" defaultValue="">
                <option value="">Times below</option>
                {codes.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.code} {c.startTime}–{c.endTime}{c.facilityName ? ` (${c.facilityName})` : ''}</option>)}
              </select>
            </label>
            <label>Start<input name="startTime" type="time" /></label>
            <label>End<input name="endTime" type="time" /></label>
            <label>From<input name="startDate" type="date" required defaultValue={days[0]} /></label>
            <label>Until <span className="muted">(for a block)</span><input name="endDate" type="date" /></label>
            <fieldset className="weekdays">
              <legend>Days (for a block)</legend>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => (
                <label key={d} className="inline"><input type="checkbox" name="weekdays" value={i + 1} />{d}</label>
              ))}
            </fieldset>
            <label style={{ flex: '0 1 110px' }}>People<input name="quantity" type="number" min={1} max={20} defaultValue={1} /></label>
            <label className="inline" style={{ flex: '0 1 auto' }}><input type="checkbox" name="equipmentOnly" />Equipment only</label>
            <button type="submit" className="btn">Add</button>
          </form>
        )}
      </details>

      <div className="roster-layout">
        <div className="roster-scroll">
          <table className="ribbon">
            <thead>
              <tr>
                <th className="who">{view === 'area' ? 'Site · area · person' : 'Person'}</th>
                {days.map(d => {
                  const ds = peopleShifts.filter(s => s.localDate === d);
                  const f = ds.filter(s => s.status !== 'open').length;
                  return (
                    <th key={d} className={d === today ? 'today' : ''}>
                      <span>{dayLabel(d)}</span>
                      <small className={ds.length && f < ds.length ? 'warn' : 'ok'}>{ds.length ? `${f} of ${ds.length}` : '—'}</small>
                    </th>
                  );
                })}
                <th className="bal">Hours</th>
              </tr>
            </thead>
            {groups.length === 0 && (
              <tbody><tr><td colSpan={9} className="muted" style={{ padding: 24 }}>No shifts this week. Use <strong>Add shifts</strong> above.</td></tr></tbody>
            )}
            {groups.map(g => (
              <tbody key={g.key}>
                <tr className="group"><th colSpan={9}>{g.title}{g.sub && <span className="muted"> · {g.sub}</span>}</th></tr>
                {g.rows.map(r => (
                  <tr key={r.key} className={`row-${r.kind}`}>
                    <th className="who" scope="row">
                      <span className="name">{r.label}</span>
                      {r.sub && <span className="sub">{r.sub}</span>}
                    </th>
                    {r.cells.map((cell, i) => (
                      <td key={i} className={days[i] === today ? 'today' : ''}>
                        {cell.map(s => (
                          <Link key={s.id} href={url({ shift: s.id })} className={`rcard ${s.equipmentOnly ? (s.status === 'open' ? 'open' : 'booked') : STATUS[s.status]?.cls ?? ''} ${selected?.id === s.id ? 'sel' : ''}`}>
                            <span className={`band ${band(s)}`}>{s.localStart}–{s.localEnd}{s.shiftCode ? ` · ${s.shiftCode}` : ''}</span>
                            <span className="st">{s.equipmentOnly ? (s.status === 'open' ? 'Needs equipment' : 'Equipment booked') : STATUS[s.status]?.label}</span>
                            <span className="ln">{r.kind === 'person' ? (view === 'person' ? `${s.role} · ${s.facilityName}` : s.role) : s.workerName ?? s.role}</span>
                            {!!s.equipment?.length && <span className="eq">+ {s.equipment.map(e => e.name).join(', ')}</span>}
                          </Link>
                        ))}
                      </td>
                    ))}
                    <td className={`bal ${r.balance?.cls ?? ''}`}>{r.balance?.text ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>

        {selected && (
          <aside className="roster-panel card" aria-label="Selected shift">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <h2 style={{ margin: 0 }}>{selected.role}</h2>
              <Link href={url({ shift: undefined })} className="muted" aria-label="Close">Close</Link>
            </div>
            <p style={{ margin: '4px 0 8px' }}>
              <strong>{longDate(selected.localDate)} · {selected.localStart}–{selected.localEnd}</strong><br />
              <span className="muted">{selected.facilityName}{selected.areaName ? ` · ${selected.areaName}` : ''} · {fmtHours(selected.hours)} h</span>
            </p>
            {panelError && <div className="notice error">{panelError}</div>}

            {!selected.equipmentOnly && (
              <section>
                <h3>Person</h3>
                {selected.workerId ? (
                  <div className="panel-row">
                    <span><strong>{selected.workerName}</strong> <span className="muted">· {selected.status === 'booked' ? 'booked' : 'waiting to confirm'}</span></span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      {selected.status === 'assigned' && (
                        <form action={confirm.bind(null, selected.id)}><input type="hidden" name="back" value={here} /><button className="btn small">Confirm</button></form>
                      )}
                      <form action={unassign.bind(null, selected.id)}><input type="hidden" name="back" value={here} /><button className="btn small secondary">Remove</button></form>
                    </span>
                  </div>
                ) : (
                  <>
                    {pendingOffers.length > 0 && (
                      <div className="offers">
                        <p className="muted" style={{ margin: '0 0 6px' }}>Offered to {pendingOffers.length}; first to accept is booked.</p>
                        {pendingOffers.map(o => (
                          <div key={o.id} className="panel-row">
                            <span>{o.workerName ?? o.name ?? candidates.find(c => c.workerId === o.workerId)?.name}</span>
                            <span style={{ display: 'flex', gap: 6 }}>
                              <form action={recordReply.bind(null, o.id, 'accept')}><input type="hidden" name="back" value={here} /><button className="btn small">Accepted</button></form>
                              <form action={recordReply.bind(null, o.id, 'decline')}><input type="hidden" name="back" value={here} /><button className="btn small secondary">Declined</button></form>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {declinedOffers.length > 0 && (
                      <p className="muted small" style={{ margin: 0 }}>
                        Said no: {declinedOffers.map(o => `${o.workerName ?? o.name ?? ''}${o.respondedVia === 'link' ? ' (by link)' : ''}`).join(', ')}
                      </p>
                    )}
                    {bankReady.length > 0 && (
                      <form action={offer.bind(null, selected.id)} className="bankfill">
                        <input type="hidden" name="back" value={here} />
                        <p style={{ margin: '0 0 6px' }}><strong>Bank fill</strong> <span className="muted">· your bank and casual staff who can work it</span></p>
                        {bankReady.slice(0, 10).map(c => (
                          <label key={c.workerId} className="inline">
                            <input type="checkbox" name="workerIds" value={c.workerId} defaultChecked />
                            {c.name} <span className="muted">· {TYPE_SHORT[c.employmentType ?? ''] ?? ''} · {fmtHours(c.weekHours)} h this week</span>
                          </label>
                        ))}
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                          <label className="inline">Offer closes in
                            <select name="expiresInMinutes" defaultValue="0">
                              <option value="0">no limit</option><option value="30">30 min</option><option value="60">1 hour</option><option value="240">4 hours</option>
                            </select>
                          </label>
                          <button className="btn small">Send offer</button>
                        </div>
                      </form>
                    )}
                    <p style={{ margin: '10px 0 4px' }}><strong>Assign directly</strong></p>
                    {candidates.filter(c => c.eligible).slice(0, 8).map(c => (
                      <div key={c.workerId} className="panel-row">
                        <span>
                          {c.name} <span className="muted">· {fmtHours(c.weekHours)} h this week</span>
                          {c.warnings.map(w => <span key={w.message} className="warnline">⚠ {w.message}</span>)}
                        </span>
                        <form action={assign.bind(null, selected.id, c.workerId)}><input type="hidden" name="back" value={here} /><button className="btn small secondary">Assign</button></form>
                      </div>
                    ))}
                    {candidates.filter(c => c.eligible).length === 0 && <p className="muted">Nobody on your staff can work this shift.</p>}
                    {candidates.some(c => !c.eligible) && (
                      <details>
                        <summary className="muted" style={{ cursor: 'pointer' }}>Can&apos;t work it ({candidates.filter(c => !c.eligible).length})</summary>
                        {candidates.filter(c => !c.eligible).map(c => (
                          <div key={c.workerId} className="blocked"><strong>{c.name}</strong>{c.blocks.map(b => <span key={b.message}>{b.message}</span>)}</div>
                        ))}
                      </details>
                    )}
                    <p className="muted small" style={{ marginTop: 10 }}>Agency fill comes next: send the shift to your agencies when your own staff can&apos;t cover it.</p>
                  </>
                )}
              </section>
            )}

            <section>
              <h3>Equipment</h3>
              {(selected.equipment ?? []).map(e => (
                <div key={e.id} className="panel-row">
                  <span>{e.name} <span className="muted">· {e.typeName}</span></span>
                  <form action={removeEquipment.bind(null, selected.id, e.id)}><input type="hidden" name="back" value={here} /><button className="btn small secondary">Remove</button></form>
                </div>
              ))}
              {equipCandidates.filter(c => c.eligible && !(selected.equipment ?? []).some(e => e.id === c.equipmentId)).slice(0, 6).map(c => (
                <div key={c.equipmentId} className="panel-row">
                  <span>{c.name} <span className="muted">· {c.typeName}</span>{c.warnings.map(w => <span key={w.message} className="warnline">⚠ {w.message}</span>)}</span>
                  <form action={bookEquipment.bind(null, selected.id, c.equipmentId)}><input type="hidden" name="back" value={here} /><button className="btn small secondary">Book</button></form>
                </div>
              ))}
              {equipCandidates.length === 0 && !(selected.equipment ?? []).length && <p className="muted">No equipment registered yet.</p>}
              {equipCandidates.some(c => !c.eligible) && (
                <details>
                  <summary className="muted" style={{ cursor: 'pointer' }}>Unavailable ({equipCandidates.filter(c => !c.eligible).length})</summary>
                  {equipCandidates.filter(c => !c.eligible).map(c => (
                    <div key={c.equipmentId} className="blocked"><strong>{c.name}</strong>{c.blocks.map(b => <span key={b.message}>{b.message}</span>)}</div>
                  ))}
                </details>
              )}
            </section>

            <section>
              <form action={cancelShift.bind(null, selected.id)} className="form-row">
                <input type="hidden" name="back" value={url({ shift: undefined })} />
                <label>Cancel shift: reason<input name="reason" required maxLength={300} placeholder="e.g. Function cancelled" /></label>
                <button className="btn small secondary">Cancel shift</button>
              </form>
            </section>
          </aside>
        )}
      </div>

      <div className="roster-legend">
        <span><i className="band am" /> AM</span><span><i className="band pm" /> PM</span><span><i className="band nd" /> Night</span>
        <span><i className="sw booked" /> Booked</span><span><i className="sw assigned" /> Assigned</span><span><i className="sw open" /> Open</span>
      </div>
    </div>
  );
}
