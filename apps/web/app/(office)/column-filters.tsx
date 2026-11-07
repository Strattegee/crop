import type { ReactNode } from 'react';

/**
 * The parts of a filter in a column heading (the recruitment list's look, 5 Nov; shared from the allocation queue, 7 Nov):
 * a compact drop-down of tick boxes, a plain select, or a drop-down holding several fields. They sit inside a
 * `ColumnFilterForm` (`column-filter-form.tsx`). `data-hold` keeps a live list (the queue's 20-second refresh) from
 * redrawing under an open drop-down. Styles: `.rl-f`, `.rl-fsum`, `.rl-fbody`, `.rl-check`, `.rl-select` in globals.css.
 */
export type Choice = { value: string; label: string; group?: string };

/** A drop-down with fields of its own and an Apply button. */
export function ColumnPop({ summary, on, label, children }: { summary: string; on: boolean; label: string; children: ReactNode }) {
  return (
    <details className="lst-pop rl-f" data-hold>
      <summary className={`rl-fsum${on ? ' on' : ''}`} aria-label={`${label}: ${summary}`}>{summary}</summary>
      <div className="lst-pop-body rl-fbody">
        {children}
        <button className="btn small">Apply</button>
      </div>
    </details>
  );
}

/** Tick boxes (under optional group headings), as part of a `ColumnPop` or on their own. */
export function ChoiceList({ name, chosen, options, empty = 'Nothing to choose from yet.' }: { name: string; chosen: string[]; options: Choice[]; empty?: string }) {
  return (
    <div className="rl-checks">
      {options.map((o, i) => (
        <span key={o.value} style={{ display: 'contents' }}>
          {o.group && o.group !== options[i - 1]?.group && <b className="rl-group">{o.group}</b>}
          <label className="rl-check"><input type="checkbox" name={name} value={o.value} defaultChecked={chosen.includes(o.value)} /> {o.label}</label>
        </span>
      ))}
      {options.length === 0 && <span className="muted small">{empty}</span>}
    </div>
  );
}

/** A multi-select: "Any", one name, or "3 chosen". */
export function ColumnMulti({ name, label, chosen, options }: { name: string; label: string; chosen: string[]; options: Choice[] }) {
  const summary = !chosen.length ? 'Any' : chosen.length === 1 ? options.find(o => o.value === chosen[0])?.label ?? chosen[0]! : `${chosen.length} chosen`;
  return (
    <ColumnPop summary={summary} on={chosen.length > 0} label={label}>
      <ChoiceList name={name} chosen={chosen} options={options} />
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
