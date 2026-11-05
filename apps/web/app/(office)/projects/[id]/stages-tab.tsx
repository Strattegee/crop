import Link from 'next/link';
import type { industryGroups } from '../../../../lib/industry-groups';
import {
  DAY_SHORT, DEFAULT_WEEKDAYS, hoursLine, hoursNote, namedWords, outsideNote, rosteredLine, stageItemChoices, stagePicker, timelineBars, timelineSpan, timelineTicks, todayAt,
  type Stage, type StagesView,
} from '../../../../lib/project-stages';
import { T, type Words } from '../../../../lib/terms';
import { MakeUpLines, type RoleRow } from '../../teams/make-up-lines';
import {
  addStage, addStagePerson, bookStageEquipment, moveStageShifts, planStageItem, removeStage, removeStageEquipment, removeStageItem, removeStagePerson, rosterProject, rosterStage,
  setProjectSupervisor, setStageRoles, setStageTeam, updateStage,
} from '../actions';

export type TeamChoice = { id: string; name: string; makeUpLine: string | null };
export type PersonChoice = { id: string; name: string; roles: string[] };
type Area = { id: string; name: string; active: boolean };
type ShiftCode = { id: string; code: string; name: string; startTime?: string; endTime?: string; active?: boolean };
type EquipmentChoice = { id: string; name: string; typeName: string; status: string };
export type ItemChoice = { id: string; name: string; unit: string; active?: boolean };

function DayBoxes({ value }: { value: number[] }) {
  return (
    <fieldset className="stage-days">
      <legend>Working days</legend>
      {DAY_SHORT.map((d, i) => (
        <label key={d}><input type="checkbox" name={`wd_${i + 1}`} defaultChecked={value.includes(i + 1)} /> {d}</label>
      ))}
    </fieldset>
  );
}

/** The stage's details: name, area, dates, working days, hours or shift type, notes. */
function StageFields({ s, areas, codes, tw }: { s?: Stage; areas: Area[]; codes: ShiftCode[]; tw: Words }) {
  return (
    <>
      <label>Name<input name="name" required maxLength={80} defaultValue={s?.name ?? ''} placeholder="e.g. Demolition and make good" /></label>
      <label>{tw.one(T.area)}
        <select name="areaId" defaultValue={s?.areaId ?? ''}>
          <option value="">Whole {tw.lower(T.project)}</option>
          {areas.filter(a => a.active || a.id === s?.areaId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <label>First day<input type="date" name="startsOn" required defaultValue={s?.startsOn ?? ''} /></label>
      <label>Last day<input type="date" name="endsOn" required defaultValue={s?.endsOn ?? ''} /></label>
      <DayBoxes value={s?.weekdays ?? DEFAULT_WEEKDAYS} />
      {codes.length > 0 && (
        <label>Shift type
          <select name="shiftCodeId" defaultValue={s?.shiftCodeId ?? ''}>
            <option value="">None: times below</option>
            {codes.filter(c => c.active !== false || c.id === s?.shiftCodeId).map(c => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </select>
        </label>
      )}
      <label>Start<input type="time" name="startTime" defaultValue={s && (s.ownTimes || !s.shiftCodeId) ? s.startTime : s ? '' : '07:00'} /></label>
      <label>Finish<input type="time" name="endTime" defaultValue={s && (s.ownTimes || !s.shiftCodeId) ? s.endTime : s ? '' : '15:30'} /></label>
      <label>Break (min)<input type="number" name="breakMinutes" min={0} max={240} defaultValue={s ? s.breakMinutes : 30} /></label>
      <label style={{ flexBasis: '100%' }}>Notes<input name="notes" maxLength={1000} defaultValue={s?.notes ?? ''} /></label>
    </>
  );
}

/** Choose a standing team to copy, or make a new one here (name and make-up). */
function TeamChooser({ teams, roleGroups, tw, current }: { teams: TeamChoice[]; roleGroups: ReturnType<typeof industryGroups<RoleRow>>; tw: Words; current?: string | null }) {
  return (
    <>
      <label>{tw.one(T.team)}
        <select name="teamId" defaultValue={current ?? ''}>
          <option value="">No {tw.lower(T.team)} yet</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name}{t.makeUpLine ? ` (${t.makeUpLine})` : ''}</option>)}
          <option value="__new">+ A new {tw.lower(T.team)} (below)</option>
        </select>
      </label>
      <details className="stage-newteam">
        <summary className="small">New {tw.lower(T.team)}: name and make-up</summary>
        <label>Name of the new {tw.lower(T.team)}<input name="newTeamName" maxLength={80} /></label>
        <MakeUpLines rows={[]} roleGroups={roleGroups} roleWord={tw.one(T.role)} />
        <p className="muted small" style={{ margin: 0 }}>Kept on the {tw.many(T.team)} page for later {tw.lower(T.project, true)}; name its people there or on this stage.</p>
      </details>
    </>
  );
}

function StageCard({ id, s, v, canEdit, tw, areas, codes, teams, roleGroups, people, equipment, items }: {
  id: string; s: Stage; v: StagesView; canEdit: boolean; tw: Words; areas: Area[]; codes: ShiftCode[]; teams: TeamChoice[];
  roleGroups: ReturnType<typeof industryGroups<RoleRow>>; people: PersonChoice[]; equipment: EquipmentChoice[]; items: ItemChoice[];
}) {
  const shifts = tw.lower(T.shift, true);
  const done = rosteredLine(s.rostered, shifts);
  const outside = outsideNote(s.rostered);
  const hours = hoursNote(s.rostered);
  const groups = stagePicker(s, people);
  const booked = new Set(s.equipment.map(e => e.equipmentId));
  return (
    <section className={`card stage-card${s.state === 'ended' ? ' off' : ''}`} id={`stage-${s.id}`}>
      <div className="team-head">
        <h2>{s.name}</h2>
        {s.state === 'current' && <span className="badge ok">Under way</span>}
        {s.state === 'ended' && <span className="badge neutral">Finished</span>}
        {s.overlaps.length > 0 && <span className="badge warn">Overlaps {s.overlaps.join(', ')}</span>}
      </div>
      <p className="small" style={{ margin: '0 0 2px' }}>{s.line}</p>
      <p className="muted small" style={{ margin: '0 0 8px' }}>{[hoursLine(s), s.areaName, s.notes].filter(Boolean).join(' · ')}</p>

      <h3 className="stage-h">{tw.one(T.team)}{s.teamName ? `: copied from ${s.teamName}` : ''}</h3>
      <p className="team-makeup">{s.makeUpLine ?? <span className="muted">No make-up set</span>} <span className="muted small">· {namedWords(s)}</span></p>
      {s.shortLine && <p style={{ margin: '0 0 6px' }}><span className="badge bad">{s.shortLine}</span></p>}
      {s.people.length > 0 ? (
        <ul className="team-people">
          {s.people.map(p => (
            <li key={p.id}>
              <span className="team-role">{p.role}</span>
              <Link href={`/workers/${p.workerId}`}>{p.name}</Link>
              {!p.active && <span className="badge bad">No longer active</span>}
              {p.roleMissing && <span className="badge warn">No longer has this {tw.lower(T.role)}</span>}
              {p.supervisor && <span className="badge neutral">{tw.one(T.project)} supervisor</span>}
              {canEdit && <form action={removeStagePerson.bind(null, id, p.id)} style={{ display: 'inline' }}><button className="btn small secondary" type="submit" title="For this stage only">Take off</button></form>}
            </li>
          ))}
        </ul>
      ) : <p className="muted small">Nobody named for this stage.</p>}

      {canEdit && (
        <div className="stage-tools">
          {groups.length > 0 && (
            <form action={addStagePerson.bind(null, id, s.id)} className="form-row">
              <label>Name someone
                <select name="pick" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {groups.map(g => <optgroup key={g.role} label={g.label}>{g.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>)}
                </select>
              </label>
              <button className="btn small" type="submit">Add</button>
            </form>
          )}
          <details>
            <summary className="small">Make-up for this stage</summary>
            <form action={setStageRoles.bind(null, id, s.id)}>
              <MakeUpLines rows={s.roles} roleGroups={roleGroups} roleWord={tw.one(T.role)} blanks={2} />
              <button className="btn small" type="submit">Save make-up</button>
            </form>
          </details>
          <details>
            <summary className="small">{s.teamId ? `Copy another ${tw.lower(T.team)}` : `Copy a ${tw.lower(T.team)}`}</summary>
            <form action={setStageTeam.bind(null, id, s.id)}>
              <TeamChooser teams={teams} roleGroups={roleGroups} tw={tw} current={s.teamId} />
              <p className="muted small">Replaces this stage&apos;s make-up and people with the {tw.lower(T.team)}&apos;s as they are now. The {tw.lower(T.team)} itself never changes.</p>
              <button className="btn small" type="submit">Copy</button>
            </form>
          </details>
        </div>
      )}

      <h3 className="stage-h">Rostering</h3>
      <p className="small" style={{ margin: '0 0 6px' }}>
        {s.placesPerDay ? `${s.placesPerDay} a day over ${s.workingDays === 1 ? '1 working day' : `${s.workingDays} working days`}` : `No places yet: name people or set a make-up`}
        {v.supervisor && ` · plus ${v.supervisor.name} as supervisor`}
        {done && <span className="muted"> · {done}</span>}
      </p>
      {outside && (
        <div className="small" style={{ margin: '0 0 6px' }}>
          <span className="badge warn">{tw.count(s.rostered.outside, T.shift)} outside the stage&apos;s dates now</span>
          {canEdit && outside.movable > 0 && (
            <form action={moveStageShifts.bind(null, id, s.id)} style={{ display: 'inline', marginLeft: 6 }}>
              <button className="btn small" type="submit">Move {outside.movable === 1 ? 'it' : outside.stay ? `${outside.movable} of them` : 'them'} to the stage&apos;s dates</button>
            </form>
          )}
          {canEdit && outside.movable > 0 && <span className="muted"> Takes {outside.movable === 1 ? 'it' : 'them'} off the Draft roster and adds what&apos;s missing on the stage&apos;s days.</span>}
          {outside.stayLine && <span className="muted"> {outside.stayLine}</span>}
          {!canEdit && !outside.stayLine && <span className="muted"> The office can move {outside.movable === 1 ? 'it' : 'them'}.</span>}
        </div>
      )}
      {hours && (
        <div className="small" style={{ margin: '0 0 6px' }}>
          <span className="badge warn">{tw.count(s.rostered.offHours, T.shift)} not at the stage&apos;s hours now</span>
          {canEdit && hours.movable > 0 && !(outside && outside.movable > 0) && (
            <form action={moveStageShifts.bind(null, id, s.id)} style={{ display: 'inline', marginLeft: 6 }}>
              <button className="btn small" type="submit">Change {hours.movable === 1 ? 'it' : hours.stay ? `${hours.movable} of them` : 'them'} to the stage&apos;s hours</button>
            </form>
          )}
          {canEdit && hours.movable > 0 && <span className="muted"> {outside && outside.movable > 0 ? 'The button above does this too.' : `Anyone who can't work the new hours comes off and the ${tw.lower(T.shift)} is left open.`}</span>}
          {hours.stayLine && <span className="muted"> {hours.stayLine}</span>}
          {!canEdit && !hours.stayLine && <span className="muted"> The office can change {hours.movable === 1 ? 'it' : 'them'}.</span>}
        </div>
      )}
      {canEdit && s.state !== 'ended' && (s.placesPerDay > 0 || v.supervisor) && (
        <form action={rosterStage.bind(null, id, s.id)}>
          <button className="btn small" type="submit">Roster this stage</button>
          <span className="muted small"> Adds only what&apos;s missing, as a Draft. People go on where they can work it; the rest stay open.</span>
        </form>
      )}

      <h3 className="stage-h">{tw.one(T.equipment)} for its dates</h3>
      {s.equipment.length ? (
        <ul className="team-people">
          {s.equipment.map(e => (
            <li key={e.id}>
              <Link href={`/equipment/${e.equipmentId}`}>{e.equipmentName}</Link> <span className="muted small">· {e.typeName} · {e.line}</span>
              {canEdit && <form action={removeStageEquipment.bind(null, id, e.id)} style={{ display: 'inline' }}><button className="btn small secondary" type="submit">Take off</button></form>}
            </li>
          ))}
        </ul>
      ) : <p className="muted small">Nothing booked for this stage.</p>}
      {canEdit && s.state !== 'ended' && equipment.length > 0 && (
        <form action={bookStageEquipment.bind(null, id, s.id)} className="form-row">
          <label>Book {tw.lower(T.equipment)} for this stage
            <select name="equipmentId" required defaultValue="">
              <option value="" disabled>Choose…</option>
              {equipment.filter(e => e.status !== 'retired' && !booked.has(e.id)).map(e => <option key={e.id} value={e.id}>{e.name} ({e.typeName})</option>)}
            </select>
          </label>
          <button className="btn small" type="submit">Book</button>
        </form>
      )}

      <h3 className="stage-h">{tw.many(T.item)} for this stage</h3>
      {s.items.length ? (
        <ul className="team-people">
          {s.items.map(i => (
            <li key={i.id ?? `used-${i.itemId}`}>
              <span>{i.name}</span> <span className="muted small">· {i.line}{i.note ? ` · ${i.note}` : ''}</span>
              {i.short && <span className="badge bad" title={`${i.short.onHand} on hand here for ${i.short.need} still to go across the stages`}>Not enough on hand</span>}
              {canEdit && i.id && <form action={removeStageItem.bind(null, id, i.id)} style={{ display: 'inline' }}><button className="btn small secondary" type="submit">Take off</button></form>}
            </li>
          ))}
        </ul>
      ) : <p className="muted small">Nothing planned. Plan what the stage will use, e.g. gloves and dust masks; what its {tw.lower(T.shift, true)} use counts against it.</p>}
      {canEdit && s.state !== 'ended' && items.length > 0 && (
        <form action={planStageItem.bind(null, id, s.id)} className="form-row">
          <label>Plan {tw.lower(T.item, true)}
            <select name="itemId" required defaultValue="">
              <option value="" disabled>Choose…</option>
              {stageItemChoices(items, s).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label>How many<input name="quantity" type="number" min="0.001" step="any" required style={{ width: 90 }} /></label>
          <label>Note<input name="note" maxLength={200} placeholder="Optional" /></label>
          <button className="btn small" type="submit">Plan</button>
        </form>
      )}

      {canEdit && (
        <details className="stage-edit">
          <summary className="small">Change this stage</summary>
          <form action={updateStage.bind(null, id, s.id)} className="form-row">
            <StageFields s={s} areas={areas} codes={codes} tw={tw} />
            <label className="inline" style={{ flexBasis: '100%' }}><input type="checkbox" name="moveLater" /> Move later stages too (by as many days as the last day moves)</label>
            {s.rostered.shifts > 0 && <label className="inline" style={{ flexBasis: '100%' }}><input type="checkbox" name="moveShifts" defaultChecked /> Bring {tw.lower(T.shift, true)} already made in line with the new dates and hours (Draft weeks only; published weeks stay for you to change on the roster; anyone who can&apos;t work new hours comes off)</label>}
            <button className="btn small" type="submit">Save</button>
          </form>
          <form action={removeStage.bind(null, id, s.id)} style={{ marginTop: 8 }}>
            {s.rostered.shifts > 0 && <label className="inline small"><input type="checkbox" name="cancelShifts" defaultChecked /> Also take its {tw.lower(T.shift, true)} off the Draft roster </label>}
            <button className="btn small secondary" type="submit" title="Kept on file">Take this stage off</button>
          </form>
        </details>
      )}
    </section>
  );
}

/** The project's stages (David, 5 Nov): a timeline across its dates, then each stage with its team copy, rostering and equipment. */
export function StagesTab({ id, v, canEdit, tw, areas, codes, teams, roleGroups, people, equipment, items, dateLabel }: {
  id: string; v: StagesView; canEdit: boolean; tw: Words; areas: Area[]; codes: ShiftCode[]; teams: TeamChoice[];
  roleGroups: ReturnType<typeof industryGroups<RoleRow>>; people: PersonChoice[]; equipment: EquipmentChoice[]; items: ItemChoice[]; dateLabel: (d: string) => string;
}) {
  const span = timelineSpan(v);
  const lay = span ? timelineBars(v.stages, span) : null;
  const ticks = span ? timelineTicks(span) : [];
  const now = span ? todayAt(span, v.today) : null;
  const supervisors = [...people].sort((a, b) => Number(b.roles.some(r => /supervis/i.test(r))) - Number(a.roles.some(r => /supervis/i.test(r))) || a.name.localeCompare(b.name));
  return (
    <>
      <div className="card">
        <h2>Supervisor</h2>
        <p className="small" style={{ marginTop: 0 }}>
          {v.supervisor
            ? <>{v.supervisor.name} <span className="muted">· rostered as {v.supervisor.role} on every working day of every stage (one {tw.lower(T.shift)} a day, even where stages overlap) · {v.supervisor.daysRostered} of {v.supervisor.workingDays} days made</span>{!v.supervisor.active && <> <span className="badge bad">No longer active</span></>}</>
            : <span className="muted">Nobody yet. The supervisor works on the {tw.lower(T.project)} full time and is rostered with every stage.</span>}
        </p>
        {canEdit && (
          <form action={setProjectSupervisor.bind(null, id)} className="form-row">
            <label>{v.supervisor ? 'Change to' : 'Choose'}
              <select name="workerId" defaultValue={v.supervisor?.workerId ?? ''}>
                <option value="">Nobody</option>
                {supervisors.map(p => <option key={p.id} value={p.id}>{p.name}{p.roles.length ? ` (${p.roles.join(', ')})` : ''}</option>)}
              </select>
            </label>
            <button className="btn small" type="submit">Save</button>
          </form>
        )}
      </div>

      <div className="card">
        <div className="team-head">
          <h2>Stages</h2>
          {canEdit && v.stages.some(s => s.state !== 'ended') && (
            <form action={rosterProject.bind(null, id)}><button className="btn small" type="submit">Roster whole {tw.lower(T.project)}</button></form>
          )}
        </div>
        {!span || !lay ? <p className="muted">No stages yet. Add the first one below, e.g. demolition 4 days, build 9 days, clean 2 days.</p> : (
          <div className="stage-timeline" role="img" aria-label={`Stages from ${dateLabel(span.from)} to ${dateLabel(span.to)}`}>
            <div className="stage-ticks">
              {ticks.map(t => <span key={t.date} className="stage-tick" style={{ left: `${t.left}%` }}>{t.label}</span>)}
            </div>
            <div className="stage-lanes" style={{ height: `${lay.lanes * 34}px` }}>
              {ticks.map(t => <span key={t.date} className="stage-gridline" style={{ left: `${t.left}%` }} />)}
              {now !== null && <span className="stage-today" style={{ left: `${now}%` }} title="Today" />}
              {lay.bars.map(b => {
                const s = v.stages.find(x => x.id === b.id)!;
                return (
                  <a key={b.id} href={`#stage-${b.id}`} className={`stage-bar${b.overlaps ? ' overlap' : ''}${s.state === 'ended' ? ' done' : ''}`}
                    style={{ left: `${b.left}%`, width: `${b.width}%`, top: `${b.lane * 34}px` }} title={`${s.name}: ${s.line}`}>
                    {s.name}
                  </a>
                );
              })}
            </div>
            <p className="muted small" style={{ margin: '6px 0 0' }}>{dateLabel(span.from)} – {dateLabel(span.to)}. Stages on a second line overlap another stage.</p>
          </div>
        )}
        {v.itemShortages.length > 0 && (
          <div className="small" style={{ marginTop: 8 }}>
            <span className="badge bad">Not enough {tw.lower(T.item, true)} on hand</span>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{v.itemShortages.map(x => <li key={x.itemId}>{x.line}</li>)}</ul>
            <p className="muted" style={{ margin: '2px 0 0' }}>Receive or transfer stock to this {tw.lower(T.project)} on the <Link href="/items">{tw.many(T.item)}</Link> page.</p>
          </div>
        )}
      </div>

      <div className="team-grid">
        {v.stages.map(s => <StageCard key={s.id} id={id} s={s} v={v} canEdit={canEdit} tw={tw} areas={areas} codes={codes} teams={teams} roleGroups={roleGroups} people={people} equipment={equipment} items={items} />)}
      </div>

      {canEdit && (
        <details className="card" open={v.stages.length === 0 || undefined}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Add a stage</summary>
          <form action={addStage.bind(null, id)} className="form-row" style={{ marginTop: 12 }}>
            <StageFields areas={areas} codes={codes} tw={tw} />
            <TeamChooser teams={teams} roleGroups={roleGroups} tw={tw} />
            <button className="btn" type="submit">Add stage</button>
          </form>
          <p className="muted small" style={{ marginBottom: 0 }}>Saturday and Sunday are off unless ticked. Choosing a {tw.lower(T.team)} copies its make-up and people into the stage; change them here for this {tw.lower(T.project)} only.</p>
        </details>
      )}
      {v.stages.length > 0 && <p className="muted small">Rostered {tw.lower(T.shift, true)} show on the <Link href={`/roster?site=${id}`}>roster</Link> as a Draft: nobody is told until you publish.</p>}
    </>
  );
}
