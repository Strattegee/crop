import type { ReactNode } from 'react';

/**
 * The parts of a filter in a column heading (the recruitment list's look, 5 Nov; shared by the allocation queue and the
 * recruitment list, 7 Nov):
 * a compact drop-down of tick boxes, a plain select, or a drop-down holding several fields. They sit inside a
 * `ColumnFilterForm` (`column-filter-form.tsx`). `data-hold` keeps a live list (the queue's 20-second refresh) from
 * redrawing under an open drop-down. Styles: `.rl-f`, `.rl-fsum`, `.rl-fbody`, `.rl-check`, `.rl-select` in globals.css.
 */
export type Choice = { value: string; label: string; group?: string };

/** A drop-down with fields of its own and an Apply button. */
export function ColumnPop({ summary, on, label, children, form, className }: { summary: string; on: boolean; label: string; children: ReactNode; form?: string; className?: string }) {
  return (
    <details className={`lst-pop rl-f${className ? ` ${className}` : ''}`} data-hold>
      <summary className={`rl-fsum${on ? ' on' : ''}`} aria-label={`${label}: ${summary}`}>{summary}</summary>
      <div className="lst-pop-body rl-fbody">
        {children}
        <button className="btn small" form={form}>Apply</button>
      </div>
    </details>
  );
}

/** Tick boxes (under optional group headings), as part of a `ColumnPop` or on their own. */
export function ChoiceList({ name, chosen, options, empty = 'Nothing to choose from yet.', form, title }: {
  name: string; chosen: string[]; options: Choice[]; empty?: string;
  /** The form's id when the tick boxes sit outside it. */
  form?: string;
  /** A heading over this list (when a drop-down holds several). */
  title?: string;
}) {
  return (
    <div className="rl-checks">
      {title && <b className="rl-group">{title}</b>}
      {options.map((o, i) => (
        <span key={o.value} style={{ display: 'contents' }}>
          {o.group && o.group !== options[i - 1]?.group && <b className="rl-group">{o.group}</b>}
          <label className="rl-check"><input type="checkbox" form={form} name={name} value={o.value} defaultChecked={chosen.includes(o.value)} /> {o.label}</label>
        </span>
      ))}
      {options.length === 0 && <span className="muted small">{empty}</span>}
    </div>
  );
}

/** What a multi-select's heading says: `any` when nothing is chosen, one name, or "3 chosen". */
export function multiSummary(chosen: string[], options: Choice[], any = 'Any'): string {
  if (!chosen.length) return any;
  if (chosen.length === 1) return options.find(o => o.value === chosen[0])?.label ?? chosen[0]!;
  return `${chosen.length} chosen`;
}

/** A multi-select: "Any" (or `any`), one name, or "3 chosen". */
export function ColumnMulti({ name, label, chosen, options, any, form, className, empty, note }: {
  name: string; label: string; chosen: string[]; options: Choice[]; any?: string; form?: string; className?: string; empty?: string;
  /** A line above the tick boxes. */
  note?: ReactNode;
}) {
  const summary = multiSummary(chosen, options, any);
  return (
    <ColumnPop summary={summary} on={chosen.length > 0} label={label} form={form} className={className}>
      {note}
      <ChoiceList name={name} chosen={chosen} options={options} form={form} empty={empty} />
    </ColumnPop>
  );
}

/** A single choice that applies as soon as it changes ("Any" = off). */
export function ColumnSelect({ name, label, value, options }: { name: string; label: string; value: string; options: Choice[] }) {
  return (
    <select name={name} defaultValue={value} aria-label={label} className={`rl-select${value ? ' on' : ''}`}>
      <option value="">Any</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
