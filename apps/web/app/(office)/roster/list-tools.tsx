'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { cancelKindChoices } from '../../../lib/cancel-kinds';
import { LIST_BULK_MAX } from '../../../lib/roster-list';
import { peopleForShifts } from './actions';
import { bulkAssign, bulkCancel, bulkConfirm, bulkDuty, bulkOffer } from './list-actions';
import type { BestPerson } from './view';

export const BULK_FORM = 'list-bulk';
/** The list's filter form: the search box, every heading's filter and the bar's (controls join it with `form=`). */
export const LIST_FILTERS = 'list-filters';
const COLLAPSED_KEY = 'crop_list_collapsed';

export type ListLabels = { shift: string; shifts: string; person: string; people: string; bank: string; client: string };

/** Typing somewhere: no shortcuts under someone's fingers. */
function typing(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}
const readCollapsed = (): string[] => {
  try { return JSON.parse(sessionStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[]; } catch { return []; }
};
const saveCollapsed = (keys: string[]) => {
  try { sessionStorage.setItem(COLLAPSED_KEY, JSON.stringify(keys.slice(-200))); } catch { /* private window: forget it */ }
};

function Busy({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return pending ? <span className="lst-busy" role="status">Working through the ticked {children}…</span> : null;
}

/**
 * The List view's live parts (client): ticking rows (Shift-click ticks a run), a group's "tick all", folding groups
 * (remembered for the visit), the bulk bar, and J/K to move between rows, Enter to open, X to tick, Esc to close the
 * panel; never while typing. The rows themselves are server-rendered links, so the list works the same after every
 * action (the server re-renders it from `GET /roster`).
 */
export function ListTools({ back, closeHref, labels, people, duties, children }: {
  back: string; closeHref: string | null; labels: ListLabels;
  people: { id: string; name: string }[]; duties: { id: string; name: string }[]; children: ReactNode;
}) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const last = useRef<HTMLInputElement | null>(null);
  const [ticked, setTicked] = useState<{ ids: string[]; open: number; waiting: number; client: boolean }>({ ids: [], open: 0, waiting: 0, client: false });
  const [best, setBest] = useState<{ for: string; people: BestPerson[] | null; error: string | null } | null>(null);
  const assignPop = useRef<HTMLDetailsElement>(null);

  const rowBoxes = useCallback(() => [...(box.current?.querySelectorAll<HTMLInputElement>('input[data-pick]') ?? [])], []);

  // What is ticked, and each group's "tick all" (ticked, part-ticked or not).
  const recount = useCallback(() => {
    const all = rowBoxes();
    const on = all.filter(b => b.checked);
    setTicked({
      ids: on.map(b => b.value.split('|')[0]!),
      open: on.filter(b => b.dataset.open === '1').length,
      waiting: on.filter(b => b.dataset.waiting === '1').length,
      client: on.some(b => b.dataset.client === '1'),
    });
    box.current?.querySelectorAll<HTMLInputElement>('input[data-gall]').forEach(g => {
      const mine = all.filter(b => b.dataset.g === g.dataset.gall);
      const n = mine.filter(b => b.checked).length;
      g.checked = n > 0 && n === mine.length;
      g.indeterminate = n > 0 && n < mine.length;
    });
    box.current?.querySelectorAll<HTMLElement>('[data-lrowbox]').forEach(r => {
      r.classList.toggle('ticked', !!r.querySelector<HTMLInputElement>('input[data-pick]:checked'));
    });
  }, [rowBoxes]);

  // Folded groups come back after every server render (new children).
  useEffect(() => {
    const folded = new Set(readCollapsed());
    box.current?.querySelectorAll<HTMLElement>('[data-group]').forEach(g => {
      const on = folded.has(g.dataset.group!);
      g.classList.toggle('folded', on);
      g.querySelector('[data-gtoggle]')?.setAttribute('aria-expanded', on ? 'false' : 'true');
    });
    recount();
  }, [children, recount]);

  const clear = useCallback(() => {
    rowBoxes().forEach(b => { b.checked = false; });
    setBest(null);
    recount();
  }, [rowBoxes, recount]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(document.activeElement) || typing(e.target as Element)) return;
      const key = e.key.toLowerCase();
      const rows = [...(box.current?.querySelectorAll<HTMLAnchorElement>('a[data-lrow]') ?? [])].filter(a => a.offsetParent !== null);
      if (key === 'j' || key === 'k') {
        if (!rows.length) return;
        e.preventDefault();
        const at = rows.indexOf(document.activeElement as HTMLAnchorElement);
        const from = at >= 0 ? at : rows.findIndex(r => r.getAttribute('aria-current') === 'true');
        const next = from < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, from + (key === 'j' ? 1 : -1)));
        rows[next]!.focus();
        rows[next]!.scrollIntoView({ block: 'nearest' });
      } else if (key === 'x') {
        const row = (document.activeElement as HTMLElement | null)?.closest('[data-lrowbox]');
        const cb = row?.querySelector<HTMLInputElement>('input[data-pick]');
        if (cb) { e.preventDefault(); cb.checked = !cb.checked; last.current = cb; recount(); }
      } else if (key === 'escape') {
        const open = document.querySelector<HTMLDetailsElement>('.lst details.lst-pop[open]');
        if (open) { e.preventDefault(); open.open = false; return; }
        if (closeHref) { e.preventDefault(); router.push(closeHref, { scroll: false }); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [router, closeHref, recount]);

  // One drop-down open at a time; a click elsewhere closes it.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Element;
      document.querySelectorAll<HTMLDetailsElement>('.lst details.lst-pop[open]').forEach(d => { if (!d.contains(t)) d.open = false; });
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  const onClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const toggle = t.closest<HTMLElement>('[data-gtoggle]');
    if (toggle) {
      const g = toggle.closest<HTMLElement>('[data-group]')!;
      const on = !g.classList.contains('folded');
      g.classList.toggle('folded', on);
      toggle.setAttribute('aria-expanded', on ? 'false' : 'true');
      const keys = new Set(readCollapsed());
      if (on) keys.add(g.dataset.group!); else keys.delete(g.dataset.group!);
      saveCollapsed([...keys]);
      return;
    }
    // Shift-click a tick box: tick (or untick) every row from the last one clicked.
    if (t instanceof HTMLInputElement && t.dataset.pick !== undefined) {
      if (e.shiftKey && last.current && last.current !== t) {
        const all = rowBoxes();
        const [a, b] = [all.indexOf(last.current), all.indexOf(t)].sort((x, y) => x - y);
        if (a! >= 0) all.slice(a, b! + 1).forEach(x => { x.checked = t.checked; });
      }
      last.current = t;
    }
  };

  const onChange = (e: React.ChangeEvent) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.gall !== undefined) rowBoxes().filter(b => b.dataset.g === t.dataset.gall).forEach(b => { b.checked = t.checked; });
    recount();
  };

  const findBest = () => {
    const ids = ticked.ids.slice(0, 30);
    const key = ids.join(',');
    setBest({ for: key, people: null, error: null });
    void peopleForShifts(ids)
      .then(res => setBest(b => b && b.for === key ? ('error' in res ? { ...b, error: res.error } : { ...b, people: res.people }) : b))
      .catch(() => setBest(b => b && b.for === key ? { ...b, error: 'Could not load the list. Please try again.' } : b));
  };

  // Ticking more or fewer: the best people are found again if Assign is open, else when it next opens.
  const idsKey = ticked.ids.slice(0, 30).join(',');
  useEffect(() => {
    if (assignPop.current?.open && idsKey) findBest();
    else setBest(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const n = ticked.ids.length;
  const tooMany = n > LIST_BULK_MAX;
  const what = n === 1 ? labels.shift : labels.shifts;
  return (
    <div ref={box} className="lst-wrap" onClick={onClick} onChange={onChange}>
      <form id={BULK_FORM} action={bulkConfirm} onKeyDown={e => { if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault(); /* never submit by Enter: each button says what it does */ }} className={`lst-bulk${n ? ' on' : ''}`} aria-label={`Act on the ticked ${labels.shifts}`}>
        <input type="hidden" name="back" value={back} />
        {n === 0 ? (
          <span className="muted small">Tick {labels.shifts} to act on several at once (Shift-click ticks a run; X ticks the row you&apos;re on).</span>
        ) : (<>
          <strong>{n} {what} ticked</strong>
          {tooMany && <span className="bad small">Up to {LIST_BULK_MAX} at a time.</span>}
          <details className="lst-pop" ref={assignPop} onToggle={e => { if ((e.currentTarget as HTMLDetailsElement).open && (!best || best.for !== idsKey)) findBest(); }}>
            <summary className="btn small">Assign…</summary>
            <div className="lst-pop-body">
              <p className="small" style={{ margin: '0 0 6px' }}>Put one {labels.person} on {n === 1 ? `this ${labels.shift}` : `the ticked ${labels.shifts}`}; any they can&apos;t do are left open and you&apos;re told why.</p>
              {best?.people === null && !best.error && <p className="muted small" role="status">Finding the best {labels.people}…</p>}
              {best?.error && <p className="bad small" role="alert">{best.error}</p>}
              {!!best?.people?.length && (
                <div className="lst-best">
                  {best.people.map(p => (
                    <button key={p.workerId} className={`lst-best-p${p.blocked ? ' blocked' : p.note ? ' warn' : ''}`} name="best" value={`${p.workerId}|${p.name}`}
                      formAction={bulkAssign} disabled={p.blocked || tooMany} title={p.note ?? undefined}>
                      <span>{p.name}{p.distance && <small className="muted"> · {p.distance}</small>}</span>
                      {p.note && <small className="muted">{p.note}</small>}
                    </button>
                  ))}
                </div>
              )}
              <div className="lst-pop-row">
                <label className="sr-only" htmlFor="lst-person">Anyone else</label>
                <select id="lst-person" name="person" defaultValue="">
                  <option value="">Anyone else…</option>
                  {people.map(p => <option key={p.id} value={`${p.id}|${p.name}`}>{p.name}</option>)}
                </select>
                <button className="btn small secondary" formAction={bulkAssign} disabled={tooMany}>Assign</button>
              </div>
            </div>
          </details>
          {ticked.open > 0 && (
            <details className="lst-pop">
              <summary className="btn small secondary">Offer…</summary>
              <div className="lst-pop-body">
                <p className="small" style={{ margin: '0 0 6px' }}>For the {ticked.open} ticked with nobody on {ticked.open === 1 ? 'it' : 'them'} and no offer waiting (others are left as they are). Text and email; the first to accept each one gets it.</p>
                <div className="lst-pop-row">
                  <button className="btn small" name="how" value="top" formAction={bulkOffer} disabled={tooMany}>Offer to the best 5 each</button>
                  <button className="btn small secondary" name="how" value="release" formAction={bulkOffer} disabled={tooMany}>Release to the {labels.bank}</button>
                </div>
              </div>
            </details>
          )}
          {ticked.waiting > 0 && (
            <button className="btn small secondary" formAction={bulkConfirm} disabled={tooMany} title={`Confirms the ${ticked.waiting} where someone has agreed (approves an agency's person)`}>Confirm {ticked.waiting}</button>
          )}
          {duties.length > 0 && (
            <details className="lst-pop">
              <summary className="btn small secondary">Add duty…</summary>
              <div className="lst-pop-body lst-pop-row">
                <label className="sr-only" htmlFor="lst-duty">Duty</label>
                <select id="lst-duty" name="dutyId" defaultValue="">
                  <option value="">Choose a duty…</option>
                  {duties.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <button className="btn small secondary" formAction={bulkDuty} disabled={tooMany}>Add</button>
              </div>
            </details>
          )}
          <details className="lst-pop">
            <summary className="btn small secondary">Cancel…</summary>
            <div className="lst-pop-body">
              <label>Why
                <select name="kind" defaultValue={ticked.client ? '' : 'other'} key={ticked.client ? 'c' : 'o'}>
                  {ticked.client && <option value="" disabled>Choose…</option>}
                  {cancelKindChoices(labels.client, ticked.client).map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
              </label>
              <label>Reason<input name="reason" maxLength={300} placeholder="e.g. Function cancelled" /></label>
              <button className="btn small secondary" formAction={bulkCancel} disabled={tooMany}>Cancel {n} {what}</button>
            </div>
          </details>
          <button type="button" className="btn small secondary" onClick={clear}>Clear</button>
          <Busy>{labels.shifts}</Busy>
        </>)}
      </form>
      {children}
    </div>
  );
}

/** A filter on the list's bar: choosing applies it straight away (the form still works without scripts). */
export function AutoSelect({ name, value, label, options }: { name: string; value: string; label: string; options: { value: string; label: string }[] }) {
  return (
    <select name={name} defaultValue={value} aria-label={label} className="q-select" onChange={e => e.currentTarget.form?.requestSubmit()}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
