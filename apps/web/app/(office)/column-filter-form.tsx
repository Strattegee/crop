'use client';

import Form from 'next/form';
import type { ReactNode } from 'react';

/**
 * A list's column-filter form (client), shared by lists with a filter in each heading (first the allocation queue, 7 Nov;
 * the recruitment list has its own copy, `recruitment/list-tools.tsx`' `FilterForm`). A GET form that navigates
 * without a full reload: a choice in a drop-down applies at once; tick boxes and text apply with their Apply button or
 * Enter; any open drop-down closes as it applies. Still works without scripts (each part has a button).
 */
export function ColumnFilterForm({ id, action, className, label, children }: { id: string; action: string; className?: string; label: string; children: ReactNode }) {
  return (
    <Form id={id} action={action} scroll={false} className={className} role="search" aria-label={label}
      onChange={e => { if (e.target instanceof HTMLSelectElement) e.currentTarget.requestSubmit(); }}
      onSubmit={e => { e.currentTarget.querySelectorAll('details[open]').forEach(d => d.removeAttribute('open')); }}>
      {children}
    </Form>
  );
}
