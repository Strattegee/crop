'use client';

/** A choice that shows the page for it straight away (the form still works without scripts). */
export function AutoSelect({ name, value, label, options }: { name: string; value: string; label: string; options: { id: string; name: string }[] }) {
  return (
    <select name={name} defaultValue={value} aria-label={label} onChange={e => e.currentTarget.form?.requestSubmit()}>
      {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}
