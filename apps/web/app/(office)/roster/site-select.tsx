'use client';

/** The site picker on the roster toolbar: changing it shows that site straight away (the form still works without scripts). */
export function SiteSelect({ name, value, allLabel, options }: { name: string; value: string; allLabel: string; options: { id: string; name: string }[] }) {
  return (
    <select name={name} defaultValue={value} aria-label="Site" onChange={e => e.currentTarget.form?.requestSubmit()}>
      <option value="">{allLabel}</option>
      {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}
