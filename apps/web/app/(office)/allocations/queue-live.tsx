'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { updatedWords } from '../../../lib/allocation-queue';
import { markPresence } from './actions';

const REFRESH_MS = 20_000;
const PRESENCE_MS = 60_000;

/** Typing somewhere (or a menu open): no shortcuts and no refresh under someone's fingers. */
function busy(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

/**
 * The allocation queue's keyboard and live parts (client): J/K move between rows (focus), Enter opens the focused row
 * (it's a link), A/O/R press the open panel's Assign top person / Offer to the top 5 / Release buttons, Esc closes the
 * panel. Refreshes the list every 20 seconds while the tab is visible and nobody is typing, and tells the API who has
 * which shift open (presence, never a lock).
 */
export function QueueLive({ closeHref, shiftId }: { closeHref: string; shiftId: string | null }) {
  const router = useRouter();
  const [updatedAt, setUpdatedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const pending = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || busy(document.activeElement) || busy(e.target as Element)) return;
      const key = e.key.toLowerCase();
      const rows = [...document.querySelectorAll<HTMLAnchorElement>('a[data-qrow]')];
      if (key === 'j' || key === 'k') {
        if (!rows.length) return;
        e.preventDefault();
        const at = rows.indexOf(document.activeElement as HTMLAnchorElement);
        const from = at >= 0 ? at : rows.findIndex(r => r.getAttribute('aria-current') === 'true');
        const next = from < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, from + (key === 'j' ? 1 : -1)));
        rows[next].focus();
        rows[next].scrollIntoView({ block: 'nearest' });
        return;
      }
      if (key === 'escape' && shiftId) {
        e.preventDefault();
        router.push(closeHref, { scroll: false });
        return;
      }
      if (key === 'a' || key === 'o' || key === 'r') {
        const btn = document.querySelector<HTMLButtonElement>(`[data-key="${key}"]`);
        if (btn && !btn.disabled) {
          e.preventDefault();
          btn.click();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [router, closeHref, shiftId]);

  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      const openForm = document.querySelector('details[open][data-hold]');
      if (document.visibilityState !== 'visible' || busy(document.activeElement) || openForm || pending.current) return;
      if (Date.now() - updatedAt < REFRESH_MS) return;
      pending.current = true;
      router.refresh();
      setUpdatedAt(Date.now());
      pending.current = false;
    }, 5_000);
    return () => clearInterval(t);
  }, [router, updatedAt]);

  // A new server render (navigation or refresh) means fresh data.
  useEffect(() => { setUpdatedAt(Date.now()); }, [shiftId]);

  useEffect(() => {
    if (!shiftId) return;
    void markPresence(shiftId);
    const t = setInterval(() => { if (document.visibilityState === 'visible') void markPresence(shiftId); }, PRESENCE_MS);
    return () => clearInterval(t);
  }, [shiftId]);

  return (
    <span className="q-live" aria-live="polite">
      <span className="q-live-dot" aria-hidden="true" />
      {updatedWords(updatedAt, now)}
    </span>
  );
}
