'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { assignToShifts, dropOnShift, peopleForShifts } from './actions';
import { withStripFilter, type BestPerson, type PickedShift, type StripFilter } from './view';

export type StripPerson = {
  id: string; name: string; initials: string; role: string; roles: string[]; type: string; typeLabel: string;
  hours: number; contracted: number | null; fit?: 'ready' | 'warn' | 'blocked'; fitNote?: string;
};
export type StripEquip = { id: string; name: string; typeName: string; status: string; hours: number; fit?: 'ready' | 'warn' | 'blocked'; fitNote?: string };
export type StripItem = { id: string; name: string; category: string; unit: string; onHand: number | null; low: boolean };
/** The business's words (Settings → Words we use), passed from the server page. */
type Labels = { people: string; equipment: string; items: string; person: string; role: string; roles: string; shift: string; shifts: string; sites: string };

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
const DRAG = 'application/x-crop-resource';
/** The search box is remembered for this tab only (a convenience; the role and hours filters live in the URL). */
const SEARCH_KEY = 'crop.roster.stripSearch';

/**
 * The left-hand strip of Steve's ribbon roster: everyone who can be rostered, with type, hours and balance
 * against contract. Drag a person onto an open shift (or equipment onto any shift) to put them on it.
 */
export function RibbonStrip({ people, equipment, items, labels, selectedShift, canDrag, filter }: {
  people: StripPerson[]; equipment: StripEquip[]; items: StripItem[]; labels: Labels; selectedShift?: string | null; canDrag: boolean;
  /** Role and "Has hours left" from the roster URL (David, 2 Nov: the filter used to reset after every drop). */
  filter: StripFilter;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'people' | 'equipment' | 'items'>('people');
  const [q, setQ] = useState('');
  const [role, setRoleState] = useState(filter.role);
  const [available, setAvailableState] = useState(filter.hoursLeft);
  const roles = useMemo(() => [...new Set(people.map(p => p.role))].sort(), [people]);
  // Follow the URL when it changes (back button, a link that carries other filters).
  useEffect(() => { setRoleState(filter.role); setAvailableState(filter.hoursLeft); }, [filter.role, filter.hoursLeft]);
  useEffect(() => { try { setQ(sessionStorage.getItem(SEARCH_KEY) ?? ''); } catch { /* storage blocked: start empty */ } }, []);
  const search = (v: string) => { setQ(v); try { sessionStorage.setItem(SEARCH_KEY, v); } catch { /* not kept */ } };
  // Filters go into the URL, so `back` on every form and drop carries them and the redirect keeps them.
  const keep = (f: StripFilter) => router.replace(withStripFilter(`${window.location.pathname}${window.location.search}`, f), { scroll: false });
  const setRole = (v: string) => { setRoleState(v); keep({ role: v, hoursLeft: available }); };
  const setAvailable = (v: boolean) => { setAvailableState(v); keep({ role, hoursLeft: v }); };
  const match = (s: string) => !q || s.toLowerCase().includes(q.trim().toLowerCase());

  const roleShown = roles.includes(role) || people.some(p => p.roles.includes(role)) ? role : '';
  const shownPeople = people.filter(p => match(p.name) && (!roleShown || p.roles.includes(roleShown))
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
      <input type="search" className="strip-search" placeholder={`Find ${tab === 'people' ? `a ${labels.person.toLowerCase()}` : 'by name'}`} value={q} onChange={e => search(e.target.value)} aria-label="Search" />

      {tab === 'people' && (
        <>
          <div className="strip-filters">
            <select value={roleShown} onChange={e => setRole(e.target.value)} aria-label={`Filter by ${labels.role.toLowerCase()}`}>
              <option value="">All {labels.roles.toLowerCase()}</option>
              {roles.map(r => <option key={r} value={r}>{r}</option>)}
              {roleShown && !roles.includes(roleShown) && <option value={roleShown}>{roleShown}</option>}
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
                    <div key={p.id} className={`strip-row ${p.fit ?? ''}`} draggable={canDrag} onDragStart={drag('person', p.id, { name: p.name, unit: '' })} onDragEnd={end}
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
          <p className="muted small strip-help">{selectedShift ? `Green can work the selected ${labels.shift.toLowerCase()}, amber with a warning, grey can’t. ` : ''}Drag a {labels.person.toLowerCase()} onto an open {labels.shift.toLowerCase()} to assign them. To fill several, Shift-click (or Ctrl/⌘-click) open {labels.shifts.toLowerCase()} to pick them, then drop the {labels.person.toLowerCase()} on any picked one. Right-click an open {labels.shift.toLowerCase()} for the best {labels.people.toLowerCase()}. Bal = contracted hours minus hours rostered. F full-time, P part-time, B bank, C casual.</p>
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

/** The business's words the drop zone's menu and picking bar use, lower case (e.g. "shift", "shifts", "staff"). */
type ZoneLabels = { shift: string; shifts: string; person: string; people: string };
type Menu = { x: number; y: number; ids: string[]; href: string | null; people: BestPerson[] | null; error: string | null };

const cardOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('[data-shift]') : null);
const isOpenCard = (el: HTMLElement | null | undefined): el is HTMLElement => !!el && el.dataset.needsPerson === '1';
const pickOf = (el: HTMLElement): PickedShift => ({ id: el.dataset.shift!, date: el.dataset.date ?? '', start: el.dataset.start ?? '' });
const fmtH = (n: number) => `${(Math.round(n * 10) / 10).toString()} h`;

/**
 * Wraps the ribbon so shift cards (data-shift) accept a dragged person, piece of equipment or item.
 * Also (David, 2 Nov): Shift-, Ctrl- or ⌘-click picks open cards so one person dropped on any picked card goes on all of
 * them; right-click (or the menu key) on an open card lists the best people for it, or for every picked card.
 */
export function DropZone({ back, labels, children }: { back: string; labels: ZoneLabels; children: ReactNode }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [menu, setMenu] = useState<Menu | null>(null);

  // Mark picked cards (they are server-rendered links). Runs again after every server render (new children),
  // dropping picks that are no longer open, e.g. once someone has been assigned.
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    const open = new Set<string>();
    root.querySelectorAll<HTMLElement>('[data-shift]').forEach(el => {
      const on = picked.includes(el.dataset.shift!);
      el.classList.toggle('picked', on);
      if (on) el.dataset.picked = '1'; else delete el.dataset.picked;
      if (isOpenCard(el)) open.add(el.dataset.shift!);
    });
    if (picked.some(id => !open.has(id))) setPicked(p => p.filter(id => open.has(id)));
  }, [picked, children]);

  const closeMenu = useCallback((refocus = true) => {
    setMenu(null);
    if (refocus) opener.current?.focus();
  }, []);

  // Esc closes the menu, else clears the picks; a click outside the menu closes it.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (menu) closeMenu();
      else if (picked.length) setPicked([]);
    };
    const onDown = (e: globalThis.MouseEvent) => { if (menu && !menuRef.current?.contains(e.target as Node)) closeMenu(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [menu, picked.length, closeMenu]);

  useEffect(() => { if (menu) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus(); }, [menu?.people, menu?.error, menu]);

  const picksFor = (ids: string[]) => ids.map(id => box.current?.querySelector<HTMLElement>(`[data-shift="${CSS.escape(id)}"]`)).filter(isOpenCard).map(pickOf);

  const assign = (workerId: string, name: string, ids: string[]) => {
    setMenu(null);
    setPicked([]);
    start(() => ids.length > 1 ? assignToShifts(workerId, name, picksFor(ids), back) : dropOnShift('person', ids[0], workerId, back));
  };

  const onClickCapture = (e: MouseEvent) => {
    if (menuRef.current?.contains(e.target as Node)) return;
    const el = cardOf(e.target);
    if (isOpenCard(el) && (e.shiftKey || e.metaKey || e.ctrlKey)) {
      // Picking, not opening: stop the link (and the browser's new tab or window).
      e.preventDefault();
      e.stopPropagation();
      const id = el.dataset.shift!;
      setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
    } else if (!el && picked.length && !(e.target instanceof Element && e.target.closest('a, button, input, select, label, .pick-bar'))) {
      setPicked([]); // a click on empty space clears the picks
    }
  };

  const onContextMenu = (e: MouseEvent) => {
    const el = cardOf(e.target);
    if (!isOpenCard(el) || menuRef.current?.contains(e.target as Node)) return;
    e.preventDefault();
    const id = el.dataset.shift!;
    const ids = picked.length > 1 && picked.includes(id) ? picked : [id];
    // From the keyboard (menu key, Shift+F10) there is no pointer position: open beside the card.
    const r = el.getBoundingClientRect();
    const fromKeys = e.clientX === 0 && e.clientY === 0;
    const x = Math.min(fromKeys ? r.right : e.clientX, window.innerWidth - 300);
    const y = Math.min(fromKeys ? r.top : e.clientY, window.innerHeight - 340);
    opener.current = el;
    setMenu({ x: Math.max(8, x), y: Math.max(8, y), ids, href: el.getAttribute('href'), people: null, error: null });
    void peopleForShifts(ids).then(res => setMenu(m => m && m.ids === ids ? ('error' in res ? { ...m, error: res.error } : { ...m, people: res.people }) : m))
      .catch(() => setMenu(m => m && m.ids === ids ? { ...m, error: 'Could not load the list. Please try again.' } : m));
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      closeMenu(false);
    }
  };

  const target = (e: DragEvent) => cardOf(e.target);
  const accepts = (el: HTMLElement | null) => {
    const kind = document.body.dataset.dragging;
    return !!el && ((kind === 'person' && el.dataset.needsPerson === '1') || ((kind === 'equipment' || kind === 'item') && el.dataset.takesEquipment === '1'));
  };
  const many = menu ? menu.ids.length > 1 : false;
  return (
    <div ref={box} className={`roster-scroll ${pending ? 'busy' : ''}`}
      onClickCapture={onClickCapture} onContextMenu={onContextMenu}
      onMouseDown={e => { if (e.shiftKey && isOpenCard(cardOf(e.target))) e.preventDefault(); /* no text selection while picking */ }}
      onDragOver={e => { const el = target(e); if (accepts(el)) { e.preventDefault(); el!.classList.add('drop'); } }}
      onDragLeave={e => target(e)?.classList.remove('drop')}
      onDrop={e => {
        const el = target(e);
        el?.classList.remove('drop');
        const raw = e.dataTransfer.getData(DRAG);
        if (!el || !raw) return;
        e.preventDefault();
        const { kind, id, name, unit } = JSON.parse(raw) as { kind: 'person' | 'equipment' | 'item'; id: string; name?: string; unit?: string };
        // A person dropped on a picked card goes on every picked card.
        if (kind === 'person' && picked.length > 1 && picked.includes(el.dataset.shift!)) {
          const ids = picked;
          setPicked([]);
          start(() => assignToShifts(id, name ?? '', picksFor(ids), back));
          return;
        }
        const to = kind === 'item'
          ? { workerId: el.dataset.worker || null, workerName: el.dataset.workerName || null, equipmentOnly: el.dataset.equipmentOnly === '1', itemName: name, itemUnit: unit }
          : {};
        start(() => dropOnShift(kind, el.dataset.shift!, id, back, to));
      }}>
      {picked.length > 0 && (
        <div className="pick-bar" role="status">
          <strong>{picked.length} {picked.length === 1 ? labels.shift : labels.shifts} picked</strong>
          <span>Drop a {labels.person} on any picked one to assign them to all, or right-click one for the best {labels.people}.</span>
          <button type="button" className="btn small secondary" onClick={() => setPicked([])}>Clear (Esc)</button>
        </div>
      )}
      {children}
      {menu && (
        <div ref={menuRef} className="shift-menu card" role="menu" aria-label={many ? `Best ${labels.people} for ${menu.ids.length} ${labels.shifts}` : `Best ${labels.people} for this ${labels.shift}`}
          style={{ left: menu.x, top: menu.y }} onKeyDown={onMenuKey}>
          <div className="shift-menu-head">{many ? `Best ${labels.people} for these ${menu.ids.length} ${labels.shifts}` : `Best ${labels.people} for this ${labels.shift}`}</div>
          {!menu.people && !menu.error && <p className="muted small shift-menu-note" role="status">Finding the best {labels.people}…</p>}
          {menu.error && <p className="small shift-menu-note bad" role="alert">{menu.error}</p>}
          {menu.people?.length === 0 && <p className="muted small shift-menu-note">Nobody to suggest.</p>}
          {!!menu.people?.length && menu.people.every(p => p.blocked) && (
            <p className="muted small shift-menu-note">Nobody can work {many ? `any of these ${labels.shifts}` : `this ${labels.shift}`}. Closest:</p>
          )}
          {menu.people?.map(p => (
            <button key={p.workerId} type="button" role="menuitem" className={`shift-menu-item ${p.blocked ? 'blocked' : p.note ? 'warn' : 'ready'}`}
              aria-disabled={p.blocked ? 'true' : undefined} tabIndex={-1}
              onClick={() => { if (!p.blocked) assign(p.workerId, p.name, menu.ids); }}
              title={p.blocked ? (p.note ?? undefined) : many ? `Assign to the ${labels.shifts} they can do` : `Assign ${p.name}`}>
              <span className="nm">{p.name}{p.note && <small>{p.note}</small>}</span>
              <span className="num">{fmtH(p.hours)}</span>
            </button>
          ))}
          <div className="shift-menu-sep" role="separator" />
          {menu.href && (
            <button type="button" role="menuitem" tabIndex={-1} className="shift-menu-item plain" onClick={() => { const h = menu.href!; setMenu(null); router.push(h); }}>
              Open {labels.shift} details
            </button>
          )}
          {picked.length > 0 && (
            <button type="button" role="menuitem" tabIndex={-1} className="shift-menu-item plain" onClick={() => { setPicked([]); closeMenu(); }}>Clear picked {labels.shifts}</button>
          )}
        </div>
      )}
    </div>
  );
}
