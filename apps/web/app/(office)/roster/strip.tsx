'use client';

import { useMemo, useState, useTransition, type DragEvent, type ReactNode } from 'react';
import { dropOnShift } from './actions';

export type StripPerson = {
  id: string; name: string; initials: string; role: string; roles: string[]; type: string; typeLabel: string;
  hours: number; contracted: number | null; fit?: 'ready' | 'warn' | 'blocked'; fitNote?: string;
};
export type StripEquip = { id: string; name: string; typeName: string; status: string; hours: number; fit?: 'ready' | 'warn' | 'blocked'; fitNote?: string };
export type StripItem = { id: string; name: string; category: string; unit: string; onHand: number | null; low: boolean };
/** The business's words (Settings → Words we use), passed from the server page. */
type Labels = { people: string; equipment: string; items: string; person: string; role: string; roles: string; shift: string; sites: string };

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
const DRAG = 'application/x-crop-resource';

/**
 * The left-hand strip of Steve's ribbon roster: everyone who can be rostered, with type, hours and balance
 * against contract. Drag a person onto an open shift (or equipment onto any shift) to put them on it.
 */
export function RibbonStrip({ people, equipment, items, labels, selectedShift, canDrag }: {
  people: StripPerson[]; equipment: StripEquip[]; items: StripItem[]; labels: Labels; selectedShift?: string | null; canDrag: boolean;
}) {
  const [tab, setTab] = useState<'people' | 'equipment' | 'items'>('people');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [available, setAvailable] = useState(false);
  const roles = useMemo(() => [...new Set(people.map(p => p.role))].sort(), [people]);
  const match = (s: string) => !q || s.toLowerCase().includes(q.trim().toLowerCase());

  const shownPeople = people.filter(p => match(p.name) && (!role || p.roles.includes(role))
    && (!available || p.contracted == null || p.contracted - p.hours > 0));
  const groups = new Map<string, StripPerson[]>();
  for (const p of shownPeople) groups.set(p.role, [...(groups.get(p.role) ?? []), p]);

  const drag = (kind: 'person' | 'equipment' | 'item', id: string, extra?: { name: string; unit: string }) => (e: DragEvent) => {
    e.dataTransfer.setData(DRAG, JSON.stringify({ kind, id, ...extra }));
    e.dataTransfer.effectAllowed = 'copy';
    document.body.dataset.dragging = kind;
  };
  const end = () => { delete document.body.dataset.dragging; };

  return (
    <aside className="roster-strip card" aria-label="People, equipment and items">
      <div className="strip-tabs" role="tablist">
        {(['people', 'equipment', 'items'] as const).map(t => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{labels[t]}</button>
        ))}
      </div>
      <input type="search" className="strip-search" placeholder={`Find ${tab === 'people' ? `a ${labels.person.toLowerCase()}` : 'by name'}`} value={q} onChange={e => setQ(e.target.value)} aria-label="Search" />

      {tab === 'people' && (
        <>
          <div className="strip-filters">
            <select value={role} onChange={e => setRole(e.target.value)} aria-label={`Filter by ${labels.role.toLowerCase()}`}>
              <option value="">All {labels.roles.toLowerCase()}</option>
              {roles.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <label className="inline small"><input type="checkbox" checked={available} onChange={e => setAvailable(e.target.checked)} />Has hours left</label>
          </div>
          <div className="strip-head" aria-hidden="true"><span /><span>{labels.person}</span><span title="Hours rostered this week">Hrs</span><span title="Contracted hours minus hours rostered">Bal</span></div>
          <div className="strip-list">
            {[...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([r, list]) => (
              <div key={r}>
                <div className="strip-group">{r} <span>{list.length}</span></div>
                {list.map(p => {
                  const bal = p.contracted == null ? null : p.contracted - p.hours;
                  return (
                    <div key={p.id} className={`strip-row ${p.fit ?? ''}`} draggable={canDrag} onDragStart={drag('person', p.id)} onDragEnd={end}
                      title={p.fitNote ?? (canDrag ? 'Drag onto an open shift' : undefined)}>
                      <span className="av" aria-hidden="true">{p.initials}</span>
                      <span className="nm">{p.name}<small><b className={`ty ty-${p.type}`}>{p.typeLabel}</b>{p.roles.length > 1 ? ` · ${p.roles.length} roles` : ''}{p.fit === 'warn' ? ' · warning' : ''}</small></span>
                      <span className="num">{fmt(p.hours)}</span>
                      <span className={`num ${bal == null ? 'muted' : bal < 0 ? 'over' : bal === 0 ? 'even' : 'under'}`}>{bal == null ? '–' : fmt(bal)}</span>
                    </div>
                  );
                })}
              </div>
            ))}
            {shownPeople.length === 0 && <p className="muted small">Nobody matches.</p>}
          </div>
          <p className="muted small strip-help">{selectedShift ? `Green can work the selected ${labels.shift.toLowerCase()}, amber with a warning, grey can’t. ` : ''}Drag a {labels.person.toLowerCase()} onto an open {labels.shift.toLowerCase()} to assign them. Bal = contracted hours minus hours rostered. F full-time, P part-time, B bank, C casual.</p>
        </>
      )}

      {tab === 'equipment' && (
        <div className="strip-list">
          {equipment.filter(e => match(`${e.name} ${e.typeName}`)).map(e => (
            <div key={e.id} className={`strip-row eq ${e.fit ?? ''} ${e.status !== 'active' ? 'blocked' : ''}`} draggable={canDrag && e.status === 'active'} onDragStart={drag('equipment', e.id)} onDragEnd={end} title={e.fitNote}>
              <span className="nm">{e.name}<small>{e.typeName}{e.status !== 'active' ? ' · out of service' : ''}</small></span>
              <span className="num">{fmt(e.hours)} h</span>
            </div>
          ))}
          {equipment.length === 0 && <p className="muted small">No {labels.equipment.toLowerCase()} registered yet.</p>}
          {equipment.length > 0 && <p className="muted small strip-help">Drag onto a {labels.shift.toLowerCase()} to book it. Hours = booked this week.</p>}
        </div>
      )}

      {tab === 'items' && (
        <div className="strip-list">
          {items.filter(i => match(`${i.name} ${i.category}`)).map(i => (
            <div key={i.id} className={`strip-row eq ${i.onHand != null && i.onHand <= 0 ? 'blocked' : ''}`} draggable={canDrag && (i.onHand == null || i.onHand > 0)}
              onDragStart={drag('item', i.id, { name: i.name, unit: i.unit })} onDragEnd={end} title={canDrag ? `Drag onto a ${labels.shift.toLowerCase()} to add one` : undefined}>
              <span className="nm">{i.name}<small>{i.category}</small></span>
              <span className={`num ${i.low ? 'over' : ''}`}>{i.onHand == null ? '–' : `${fmt(i.onHand)} ${i.unit}`}</span>
            </div>
          ))}
          {items.length === 0 && <p className="muted small">No {labels.items.toLowerCase()} yet.</p>}
          {items.length > 0 && <p className="muted small strip-help">On hand across all {labels.sites.toLowerCase()}; red is at or below the reorder level. Drag one onto a {labels.shift.toLowerCase()} to add it (given to the {labels.person.toLowerCase()} on it, or used on the {labels.shift.toLowerCase()}); its panel opens to change how many.</p>}
        </div>
      )}
    </aside>
  );
}

/** Wraps the ribbon so shift cards (data-shift) accept a dragged person, piece of equipment or item. */
export function DropZone({ back, children }: { back: string; children: ReactNode }) {
  const [pending, start] = useTransition();
  const target = (e: DragEvent) => (e.target as HTMLElement).closest<HTMLElement>('[data-shift]');
  const accepts = (el: HTMLElement | null) => {
    const kind = document.body.dataset.dragging;
    return !!el && ((kind === 'person' && el.dataset.needsPerson === '1') || ((kind === 'equipment' || kind === 'item') && el.dataset.takesEquipment === '1'));
  };
  return (
    <div className={`roster-scroll ${pending ? 'busy' : ''}`}
      onDragOver={e => { const el = target(e); if (accepts(el)) { e.preventDefault(); el!.classList.add('drop'); } }}
      onDragLeave={e => target(e)?.classList.remove('drop')}
      onDrop={e => {
        const el = target(e);
        el?.classList.remove('drop');
        const raw = e.dataTransfer.getData(DRAG);
        if (!el || !raw) return;
        e.preventDefault();
        const { kind, id, name, unit } = JSON.parse(raw) as { kind: 'person' | 'equipment' | 'item'; id: string; name?: string; unit?: string };
        const to = kind === 'item'
          ? { workerId: el.dataset.worker || null, workerName: el.dataset.workerName || null, equipmentOnly: el.dataset.equipmentOnly === '1', itemName: name, itemUnit: unit }
          : {};
        start(() => dropOnShift(kind, el.dataset.shift!, id, back, to));
      }}>
      {children}
    </div>
  );
}
