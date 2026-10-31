import type { IndustryGroup } from '../../../lib/industry-groups';

type Role = { id: string; name: string };

/**
 * Roles as tick boxes grouped by industry (David, 31 Oct), plus a box for any other role. Names are kept exactly as
 * listed, because credential rules match roles exactly.
 */
export function RolePicker({ groups, current = [], label }: { groups: IndustryGroup<Role>[]; current?: string[]; label: string }) {
  const listed = new Set(groups.flatMap(g => g.items.map(r => r.name)));
  const others = current.filter(r => !listed.has(r));
  return (
    <fieldset className="role-picker">
      <legend>{label}</legend>
      {groups.map(g => (
        <div key={g.key} className="role-group">
          {groups.length > 1 && <div className="grp-h">{g.label}</div>}
          {g.items.map(r => (
            <label key={r.id} className="inline"><input type="checkbox" name="roleNames" value={r.name} defaultChecked={current.includes(r.name)} />{r.name}</label>
          ))}
        </div>
      ))}
      <label>Other {label.toLowerCase()} <span className="muted">(comma separated)</span>
        <input name="roles" defaultValue={others.join(', ')} maxLength={200} />
      </label>
    </fieldset>
  );
}
