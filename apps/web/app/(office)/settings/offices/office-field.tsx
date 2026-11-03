/**
 * The Office choice on a site's forms (David, 3 Nov 2026). Shown only when the business has offices; a site kept in a
 * switched-off office keeps it until another is chosen.
 */
export function OfficeField({ offices, value }: { offices: { id: string; name: string; active: boolean }[]; value?: string | null }) {
  const live = offices.filter(o => o.active || o.id === value);
  if (live.length === 0) return null;
  return (
    <label>Office
      <select name="officeId" defaultValue={value ?? ''}>
        <option value="">No office</option>
        {live.map(o => <option key={o.id} value={o.id}>{o.name}{o.active ? '' : ' (switched off)'}</option>)}
      </select>
    </label>
  );
}
