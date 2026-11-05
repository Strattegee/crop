import Link from 'next/link';
import { api } from '../../../lib/api';
import { currentAgency } from '../../../lib/current-user';
import { industryGroups, needsHeadings, type PackInfo } from '../../../lib/industry-groups';
import { awayLine, awayWords, BLANK_MAKE_UP_LINES, namedLine, pickerGroups, teamFilter, type MakeUpRow, type PickPerson, type Team } from '../../../lib/teams';
import { T, words } from '../../../lib/terms';
import { formatDate } from '../../../lib/format';
import { businessZone, todayIn } from '../../../lib/business';
import { Notices } from '../notices';
import { addTeam, addTeamPerson, removeTeamPerson, setTeamActive, setTeamRoles, updateTeam } from './actions';

export const dynamic = 'force-dynamic';

type RoleRow = { id: string; name: string; active: boolean; industries?: string[] };
type WorkerRow = { id: string; firstName: string; lastName: string; preferredName: string | null; roles: string[] };

/** One make-up line: a role (grouped by industry, like every role list) and how many. */
function RoleLine({ i, row, roleGroups, roleWord }: { i: number; row?: MakeUpRow; roleGroups: ReturnType<typeof industryGroups<RoleRow>>; roleWord: string }) {
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

function MakeUpLines({ rows, roleGroups, roleWord, blanks = BLANK_MAKE_UP_LINES }: { rows: MakeUpRow[]; blanks?: number; roleGroups: ReturnType<typeof industryGroups<RoleRow>>; roleWord: string }) {
  const n = rows.length + blanks;
  return (
    <>
      <input type="hidden" name="lines" value={n} />
      {Array.from({ length: n }, (_, i) => <RoleLine key={i} i={i} row={rows[i]} roleGroups={roleGroups} roleWord={roleWord} />)}
    </>
  );
}

/**
 * Standing teams (David, 5 Nov): the business's own teams, kept over time outside any project. Each has a make-up
 * (how many of each role) and named people; the make-up shows which trade is missing when someone is away or leaves.
 * Function code 3300, in the Workers menu.
 */
export default async function TeamsPage({ searchParams }: { searchParams: Promise<{ show?: string; team?: string; new?: string; error?: string; done?: string }> }) {
  const sp = await searchParams;
  const show = teamFilter(sp.show);
  const [tw, agency, zone] = await Promise.all([words(), currentAgency(), businessZone()]);
  const tm = tw.one(T.team), tms = tw.many(T.team);
  const limited = agency?.sites != null;
  if (limited) {
    return (
      <>
        <h1>{tms}</h1>
        <p className="muted">{tms} cover every {tw.lower(T.site)}, so they are looked after by people who see every {tw.lower(T.site)}. Ask an owner or admin.</p>
      </>
    );
  }
  const [data, roles, packs, workers] = await Promise.all([
    api<{ teams: Team[] }>(`/teams${show === 'live' ? '' : `?status=${show === 'archived' ? 'archived' : 'all'}`}`),
    api<RoleRow[]>('/roles').catch(() => [] as RoleRow[]),
    api<PackInfo[]>('/industry-packs').catch(() => [] as PackInfo[]),
    api<WorkerRow[]>('/workers?status=active').catch(() => [] as WorkerRow[]),
  ]);
  const roleGroups = industryGroups(roles.filter(r => r.active !== false), packs);
  const roleWord = tw.one(T.role);
  const people: PickPerson[] = workers.map(w => ({ id: w.id, name: `${w.preferredName || w.firstName} ${w.lastName}`, roles: w.roles ?? [] }));
  const today = todayIn(zone);
  const worker = tw.lower(T.worker, true);
  return (
    <>
      <h1>{tms}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Your standing {tms.toLowerCase()}: the people you keep together from job to job. Each {tm.toLowerCase()} has its make-up (how many of each {roleWord.toLowerCase()})
        and its named {worker}; the make-up shows which {roleWord.toLowerCase()} is missing when someone is away or leaves.
      </p>
      <Notices error={sp.error} done={sp.done} />
      <nav className="q-chips" aria-label="Show" style={{ marginBottom: 12 }}>
        {(['live', 'archived', 'all'] as const).map(v => (
          <Link key={v} href={v === 'live' ? '/teams' : `/teams?show=${v}`} className={`q-chip${show === v ? ' on' : ''}`} aria-current={show === v ? 'page' : undefined}>
            {v === 'live' ? 'Current' : v === 'archived' ? 'Put away' : 'All'}
          </Link>
        ))}
      </nav>

      {data.teams.length === 0 && (
        <div className="card"><p className="muted" style={{ margin: 0 }}>{show === 'archived' ? `No ${tms.toLowerCase()} put away.` : `No ${tms.toLowerCase()} yet.`}</p></div>
      )}

      <div className="team-grid">
        {data.teams.map(t => {
          const groups = pickerGroups(t, people);
          const away = awayLine(t);
          return (
            <section key={t.id} id={`team-${t.id}`} className={`card team-card${t.active ? '' : ' off'}`}>
              <div className="team-head">
                <h2>{t.name}</h2>
                {!t.active && <span className="badge neutral">Put away</span>}
              </div>
              {t.description && <p className="muted small" style={{ marginTop: 0 }}>{t.description}</p>}
              <p className="team-makeup">{t.makeUpLine ?? <span className="muted">No make-up set</span>}</p>
              <p className="small muted" style={{ margin: '0 0 8px' }}>{namedLine(t)}</p>
              {(t.shortLine || t.shortTodayLine || away) && (
                <div className="team-alerts">
                  {t.shortLine && <span className="badge bad">{t.shortLine}</span>}
                  {t.shortTodayLine && <span className="badge warn">{t.shortTodayLine}</span>}
                  {away && <span className="badge warn">{away}</span>}
                </div>
              )}
              {t.members.length > 0 ? (
                <ul className="team-people">
                  {t.members.map(m => (
                    <li key={m.id}>
                      <span className="team-role">{m.role}</span>
                      <Link href={`/workers/${m.workerId}`}>{m.name}</Link>
                      {awayWords(m.away) && <span className={`badge ${m.away === 'not_active' ? 'bad' : 'warn'}`}>{awayWords(m.away)}</span>}
                      {m.roleMissing && <span className="badge warn">No longer has this {roleWord.toLowerCase()}</span>}
                      {m.state === 'upcoming' && <span className="muted small">from {formatDate(m.startsOn)}</span>}
                    </li>
                  ))}
                </ul>
              ) : <p className="muted small">Nobody named yet.</p>}

              <details className="team-edit" open={sp.team === t.id || undefined}>
                <summary>Change this {tm.toLowerCase()}</summary>
                {t.active ? (
                  <>
                    <h3>Add someone</h3>
                    {groups.length ? (
                      <form action={addTeamPerson.bind(null, t.id)} className="form-row">
                        <label>Person and {roleWord.toLowerCase()}
                          <select name="pick" required defaultValue="">
                            <option value="" disabled>Choose…</option>
                            {groups.map(g => <optgroup key={g.role} label={g.label}>{g.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>)}
                          </select>
                        </label>
                        <label>From<input type="date" name="startsOn" defaultValue={today} /></label>
                        <button type="submit" className="btn small">Add</button>
                      </form>
                    ) : <p className="muted small">Nobody else active has a {roleWord.toLowerCase()} to fill here.</p>}

                    {t.members.length > 0 && (
                      <>
                        <h3>Take someone off</h3>
                        <p className="muted small" style={{ marginTop: 0 }}>They stay on file with their last day. Someone added today or starting later is simply removed.</p>
                        {t.members.map(m => (
                          <form key={m.id} action={removeTeamPerson.bind(null, t.id, m.id)} className="form-row team-remove">
                            <span>{m.name} <span className="muted small">· {m.role}</span></span>
                            <label>Last day<input type="date" name="lastDay" /></label>
                            <label>Reason (optional)<input name="reason" maxLength={200} placeholder="e.g. Moved to another team" /></label>
                            <button type="submit" className="btn small secondary">Take off</button>
                          </form>
                        ))}
                      </>
                    )}

                    <h3>Make-up</h3>
                    <form action={setTeamRoles.bind(null, t.id)} className="team-makeup-form">
                      <MakeUpLines rows={t.roles} roleGroups={roleGroups} roleWord={roleWord} />
                      <button type="submit" className="btn small">Save make-up</button>
                    </form>

                    <h3>Name and description</h3>
                    <form action={updateTeam.bind(null, t.id)} className="form-row">
                      <label>Name<input name="name" required maxLength={80} defaultValue={t.name} /></label>
                      <label style={{ flexBasis: '100%' }}>Description<textarea name="description" rows={2} maxLength={1000} defaultValue={t.description ?? ''} /></label>
                      <button type="submit" className="btn small">Save</button>
                    </form>

                    <form action={setTeamActive.bind(null, t.id, false)} style={{ marginTop: 12 }}>
                      <button type="submit" className="btn small secondary">Put this {tm.toLowerCase()} away</button>
                      <span className="muted small"> Kept on file with its history; it can be brought back.</span>
                    </form>
                  </>
                ) : (
                  <form action={setTeamActive.bind(null, t.id, true)}>
                    <button type="submit" className="btn small">Bring it back</button>
                  </form>
                )}
                {t.earlier.length > 0 && (
                  <>
                    <h3>Earlier</h3>
                    <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                      {t.earlier.map(m => (
                        <li key={m.id}>{m.name} · {m.role} · until {formatDate(m.endsOn)}{m.endReason && <span className="muted"> · {m.endReason}</span>}</li>
                      ))}
                    </ul>
                  </>
                )}
              </details>
            </section>
          );
        })}
      </div>

      <details className="card" open={sp.new === '1' || (data.teams.length === 0 && show === 'live') || undefined}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>+ New {tm.toLowerCase()}</summary>
        <p className="muted small">Give it a name and its make-up; you name its people on its card next.</p>
        <form action={addTeam} className="team-makeup-form">
          <div className="form-row">
            <label>Name<input name="name" required maxLength={80} placeholder="e.g. Demolition and make good" /></label>
            <label style={{ flexBasis: '100%' }}>Description (optional)<textarea name="description" rows={2} maxLength={1000} /></label>
          </div>
          <h3>Make-up</h3>
          <MakeUpLines rows={[]} roleGroups={roleGroups} roleWord={roleWord} blanks={6} />
          <button type="submit" className="btn">Add {tm.toLowerCase()}</button>
        </form>
      </details>
    </>
  );
}
