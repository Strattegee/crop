'use client';

import Form from 'next/form';
import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A list's column-filter form (client), shared by lists with a filter in each heading (the allocation queue, the
 * recruitment list and the roster's List, 7 Nov). A GET form that navigates
 * without a full reload: a choice in a drop-down applies at once; tick boxes and text apply with their Apply button or
 * Enter; any open drop-down closes as it applies. Still works without scripts (each part has a button).
 * Controls may sit outside the form and join it with `form={id}` (the roster List's headings live in a table beside
 * its bulk form): those are watched on the document.
 */
export function ColumnFilterForm({ id, action, className, label, children }: { id: string; action: string; className?: string; label: string; children: ReactNode }) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const onChange = (e: Event) => {
      const form = ref.current, t = e.target;
      if (form && t instanceof HTMLSelectElement && t.form === form && !form.contains(t)) form.requestSubmit();
    };
    document.addEventListener('change', onChange);
    return () => document.removeEventListener('change', onChange);
  }, []);
  return (
    <Form ref={ref} id={id} action={action} scroll={false} className={className} role="search" aria-label={label}
      onChange={e => { if (e.target instanceof HTMLSelectElement) e.currentTarget.requestSubmit(); }}
      onSubmit={e => { closeOpen(e.currentTarget); }}>
      {children}
    </Form>
  );
}

/** Closes every open drop-down holding a part of this form, inside it or joined with `form=`. */
function closeOpen(form: HTMLFormElement) {
  document.querySelectorAll('details[open]').forEach(d => {
    const joined = form.contains(d) || [...d.querySelectorAll('input, select, button')].some(el => (el as HTMLInputElement).form === form);
    if (joined) d.removeAttribute('open');
  });
}
