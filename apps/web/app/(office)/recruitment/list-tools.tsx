'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { MOVE_STAGES, RECRUIT_BULK_MAX, STAGE_LABEL } from '../../../lib/recruitment-list';
import { bulkAsk, bulkMove, bulkNotProceeding, bulkOnboard } from './list-actions';

export const RL_BULK = 'rl-bulk';
export const RL_FILTERS = 'rl-filters';

const typing = (el: Element | null) => {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
};

function Busy() {
  const { pending } = useFormStatus();
  return pending ? <span className="lst-busy" role="status">Working through the ticked people…</span> : null;
}

/**
 * The filter row's form (client): a choice in a drop-down applies at once; tick boxes apply with their Apply button or
 * Enter; it still works without scripts (each part has a button).
 */
export function FilterForm({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <form id={RL_FILTERS} method="get" action="/recruitment" className={className} role="search"
      onChange={e => { if (e.target instanceof HTMLSelectElement) e.currentTarget.requestSubmit(); }}>
      {children}
    </form>
  );
}

/**
 * The list's live parts (client): tick boxes (Shift-click ticks a run, the heading's box ticks the page), the bulk bar,
 * and J/K to move between rows, Enter to open, X to tick, Esc to close a menu or clear the ticks; never while typing.
 */
export function RecruitTools({ back, canOnboard, rosterWord, children }: { back: string; canOnboard: boolean; rosterWord: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const last = useRef<HTMLInputElement | null>(null);
  const [ticked, setTicked] = useState({ n: 0, applicants: 0, noEmail: 0 });

  const boxes = useCallback(() => [...(box.current?.querySelectorAll<HTMLInputElement>('input[data-pick]') ?? [])], []);
  const recount = useCallback(() => {
    const all = boxes();
    const on = all.filter(b => b.checked);
    setTicked({
      n: on.length,
      applicants: on.filter(b => ['applied', 'screening', 'interview', 'offer'].includes(b.value.split('|')[3] ?? '')).length,
      noEmail: on.filter(b => b.value.split('|')[2] !== '1').length,
    });
    const all1 = box.current?.querySelector<HTMLInputElement>('input[data-pickall]');
    if (all1) {
      all1.checked = on.length > 0 && on.length === all.length;
      all1.indeterminate = on.length > 0 && on.length < all.length;
    }
    box.current?.querySelectorAll<HTMLElement>('[data-rlrow]').forEach(r => {
      r.classList.toggle('ticked', !!r.querySelector<HTMLInputElement>('input[data-pick]:checked'));
    });
  }, [boxes]);
  useEffect(() => { recount(); }, [children, recount]);

  const clear = useCallback(() => { boxes().forEach(b => { b.checked = false; }); recount(); }, [boxes, recount]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(document.activeElement) || typing(e.target as Element)) return;
      const key = e.key.toLowerCase();
      const rows = [...(box.current?.querySelectorAll<HTMLAnchorElement>('a[data-lrow]') ?? [])].filter(a => a.offsetParent !== null);
      if (key === 'j' || key === 'k') {
        if (!rows.length) return;
        e.preventDefault();
        const at = rows.indexOf(document.activeElement as HTMLAnchorElement);
        const next = at < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, at + (key === 'j' ? 1 : -1)));
        rows[next]!.focus();
        rows[next]!.scrollIntoView({ block: 'nearest' });
      } else if (key === 'x') {
        const cb = (document.activeElement as HTMLElement | null)?.closest('[data-rlrow]')?.querySelector<HTMLInputElement>('input[data-pick]');
        if (cb) { e.preventDefault(); cb.checked = !cb.checked; last.current = cb; recount(); }
      } else if (key === 'escape') {
        const open = document.querySelector<HTMLDetailsElement>('.rl details[open]');
        if (open) { e.preventDefault(); open.open = false; return; }
        if (boxes().some(b => b.checked)) { e.preventDefault(); clear(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [recount, clear, boxes]);

  // Only one filter or bulk menu open at a time; a click elsewhere closes it.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element;
      document.querySelectorAll<HTMLDetailsElement>('.rl details.lst-pop[open]').forEach(d => { if (!d.contains(t)) d.open = false; });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  const onClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement && t.dataset.pick !== undefined) {
      if (e.shiftKey && last.current && last.current !== t) {
        const all = boxes();
        const [a, b] = [all.indexOf(last.current), all.indexOf(t)].sort((x, y) => x - y);
        if (a! >= 0) all.slice(a, b! + 1).forEach(x => { x.checked = t.checked; });
      }
      last.current = t;
    }
  };
  const onChange = (e: React.ChangeEvent) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.pickall !== undefined) boxes().forEach(b => { b.checked = t.checked; });
    recount();
  };

  const { n } = ticked;
  const tooMany = n > RECRUIT_BULK_MAX;
  return (
    <div ref={box} onClick={onClick} onChange={onChange}>
      <form id={RL_BULK} action={bulkMove} className={`lst-bulk${n ? ' on' : ''}`} aria-label="Act on the ticked people"
        onKeyDown={e => { if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault(); }}>
        <input type="hidden" name="back" value={back} />
        {n === 0 ? (
          <span className="muted small">Tick people to act on several at once (Shift-click ticks a run; X ticks the row you&apos;re on).</span>
        ) : (<>
          <strong>{n} ticked</strong>
          {tooMany && <span className="bad small">Up to {RECRUIT_BULK_MAX} at a time.</span>}
          {ticked.applicants > 0 && (
            <details className="lst-pop">
              <summary className="btn small">Move to…</summary>
              <div className="lst-pop-body">
                <p className="small" style={{ margin: 0 }}>Moves the {ticked.applicants} ticked applicant{ticked.applicants === 1 ? '' : 's'}; anyone already there or past Offer is left as they are.</p>
                <div className="lst-pop-row">
                  {MOVE_STAGES.map(s => (
                    <button key={s} className="btn small secondary" name="stage" value={s} formAction={bulkMove} disabled={tooMany}>{STAGE_LABEL[s]}</button>
                  ))}
                </div>
              </div>
            </details>
          )}
          {ticked.applicants > 0 && canOnboard && (
            <details className="lst-pop">
              <summary className="btn small secondary">Start onboarding…</summary>
              <div className="lst-pop-body">
                <p className="small" style={{ margin: 0 }}>Each gets the onboarding checklist for their roles and stays off the {rosterWord} until it&apos;s finished.</p>
                <button className="btn small" formAction={bulkOnboard} disabled={tooMany}>Start onboarding for {ticked.applicants}</button>
              </div>
            </details>
          )}
          <details className="lst-pop">
            <summary className="btn small secondary">Ask for documents…</summary>
            <div className="lst-pop-body">
              <p className="small" style={{ margin: 0 }}>Emails each person what&apos;s still needed with a link to send it (people being onboarded get their checklist&apos;s list).{ticked.noEmail > 0 ? ` ${ticked.noEmail} without an email address will be skipped.` : ''}</p>
              <label>Note (optional)<input name="askNote" maxLength={500} placeholder="e.g. Please send these by Friday" /></label>
              <label className="check"><input type="checkbox" name="sms" /> Also text them</label>
              <button className="btn small" formAction={bulkAsk} disabled={tooMany}>Ask {n}</button>
            </div>
          </details>
          {ticked.applicants > 0 && (
            <details className="lst-pop">
              <summary className="btn small secondary">Not proceeding…</summary>
              <div className="lst-pop-body">
                <label>Reason (optional)<input name="note" maxLength={500} placeholder="e.g. Position filled" /></label>
                <button className="btn small secondary" formAction={bulkNotProceeding} disabled={tooMany}>Mark {ticked.applicants} as not proceeding</button>
              </div>
            </details>
          )}
          <button type="button" className="btn small secondary" onClick={clear}>Clear</button>
          <Busy />
        </>)}
      </form>
      {children}
    </div>
  );
}
