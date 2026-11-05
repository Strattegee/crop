import { industryGroups, needsHeadings } from '../../../lib/industry-groups';
import { BLANK_MAKE_UP_LINES, type MakeUpRow } from '../../../lib/teams';

export type RoleRow = { id: string; name: string; active: boolean; industries?: string[] };

/** One make-up line: a role (grouped by industry, like every role list) and how many. */
export function RoleLine({ i, row, roleGroups, roleWord }: { i: number; row?: MakeUpRow; roleGroups: ReturnType<typeof industryGroups<RoleRow>>; roleWord: string }) {
  const known = roleGroups.some(g => g.items.some(r => r.name === row?.role));
  return (
    <div className="team-line">
      <label>{roleWord}
        <select name={`role_${i}`} defaultValue={row?.role ?? ''}>
          <option value="">{row ? `No ${roleWord.toLowerCase()} (drop this line)` : '—'}</option>
          {row && !known && <option value={row.role}>{row.role}</option>}
          {needsHeadings(roleGroups)
            ? roleGroups.map(g => <optgroup key={g.key} label={g.label}>{g.items.map(r => <option key={r.name} value={r.name}>{r.name}</option>)}</optgroup>)
            : roleGroups.flatMap(g => g.items).map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
        </select>
      </label>
      <label>How many<input type="number" name={`count_${i}`} min={0} max={99} defaultValue={row?.count ?? 1} /></label>
    </div>
  );
}

export function MakeUpLines({ rows, roleGroups, roleWord, blanks = BLANK_MAKE_UP_LINES }: { rows: MakeUpRow[]; blanks?: number; roleGroups: ReturnType<typeof industryGroups<RoleRow>>; roleWord: string }) {
  const n = rows.length + blanks;
  return (
    <>
      <input type="hidden" name="lines" value={n} />
      {Array.from({ length: n }, (_, i) => <RoleLine key={i} i={i} row={rows[i]} roleGroups={roleGroups} roleWord={roleWord} />)}
    </>
  );
}

