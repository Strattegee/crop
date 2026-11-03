import Link from 'next/link';
import { api } from '../../../../lib/api';
import { businessSettings, businessZone, todayIn } from '../../../../lib/business';
import { lettersOf } from '../../../../lib/marker-letters';
import { T, words } from '../../../../lib/terms';
import {
  WEEKDAYS, WEEKDAY_NAMES, dayTotals, periodLetter, templateGrid, templateHref, type TemplateShift,
} from '../../../../lib/roster-template';
import { Notices } from '../../notices';
import { addDays, mondayOf, shiftMarkers } from '../view';
import { AutoSelect } from './auto-select';
import {
  addTemplateShifts, changeTemplateShift, fillWeekFromTemplate, putAwayTemplate, removeTemplateShift, renameTemplate, startTemplate,
} from './actions';

export const dynamic = 'force-dynamic';

type Facility = { id: string; name: string; active: boolean };
type FacilityDetail = Facility & { areas: { id: string; name: string; active: boolean }[] };
type TemplateRow = { id: string; facilityId: string; name: string; shifts: number; withPeople: number; createdByName: string | null };
type TemplateDetail = TemplateRow & { facilityName: string; shiftList: TemplateShift[] };
type ShiftCode = { id: string; facilityId: string | null; code: string; name: string | null; letter?: string | null; startTime: string; endTime: string; breakMinutes: number; active: boolean };
type Worker = { id: string; firstName: string; lastName: string; preferredName: string | null; roles: string[] };
type Role = { id: string; name: string };
type Duty = { id: string; name: string; active: boolean };
type Equip = { id: string; name: string; typeName?: string; status: string };

/**
 * The Template tab (David, 3 Nov, answer 2; function code 2050): a site's templates as a week, to build and change
 * before filling a week from them. Template · Draft · Live · History, with Template chosen.
 */
export default async function TemplateTab({ searchParams }: {
  searchParams: Promise<{ site?: string; template?: string; slot?: string; add?: string; area?: string; error?: string; done?: string }>;
}) {
  const [sp, tw, settings, zone] = await Promise.all([searchParams, words(), businessSettings(), businessZone()]);
  const facilities = (await api<Facility[]>('/facilities')).filter(f => f.active);
  const site = facilities.find(f => f.id === sp.site)?.id ?? facilities[0]?.id ?? null;
  const letters = lettersOf(settings.markerLetters);
  const nextMonday = addDays(mondayOf(todayIn(zone)), 7);

  const [templates, facility] = site ? await Promise.all([
    api<TemplateRow[]>(`/roster/templates?facilityId=${site}`), api<FacilityDetail>(`/facilities/${site}`),
  ]) : [[] as TemplateRow[], null];
  const chosenId = templates.find(t => t.id === sp.template)?.id ?? templates[0]?.id ?? null;
  const [tpl, codes, workers, roles, duties, equipment] = chosenId ? await Promise.all([
    api<TemplateDetail>(`/roster/templates/${chosenId}`),
    api<ShiftCode[]>(`/shift-codes?facilityId=${site}`).catch(() => [] as ShiftCode[]),
    api<Worker[]>('/workers?status=active').catch(() => [] as Worker[]),
    api<Role[]>('/roles').catch(() => [] as Role[]),
    api<Duty[]>('/shift-duties').catch(() => [] as Duty[]),
    api<Equip[]>('/equipment').catch(() => [] as Equip[]),
  ]) : [null, [], [], [], [], []];

  const href = (extra: Record<string, string | null | undefined> = {}) => templateHref(site, chosenId, extra);
  const areas = (facility?.areas ?? []).filter(a => a.active);
  const grid = tpl ? templateGrid(tpl.shiftList, areas, `No ${tw.lower(T.area)}`) : [];
  const totals = tpl ? dayTotals(tpl.shiftList) : [];
  const editing = tpl?.shiftList.find(s => s.id === sp.slot) ?? null;
  const addDay = Number(sp.add);
  const adding = !editing && Number.isInteger(addDay) && addDay >= 1 && addDay <= 7 ? addDay : null;
  const people = workers.map(w => ({ id: w.id, name: `${w.preferredName || w.firstName} ${w.lastName}` })).sort((a, b) => a.name.localeCompare(b.name));
  const roleNames = [...new Set(roles.map(r => r.name))].sort((a, b) => a.localeCompare(b));
  const liveCodes = codes.filter(c => c.active);
  const hidden = (<><input type="hidden" name="site" value={site ?? ''} /><input type="hidden" name="template" value={chosenId ?? ''} /></>);

  // The panel's form, for adding (several days) or changing one template shift.
  const shiftForm = (s: TemplateShift | null) => (
    <form action={s ? changeTemplateShift.bind(null, s.id) : addTemplateShifts} className="tpl-form">
      {hidden}
      {s ? (
        <label>Day
          <select name="weekday" defaultValue={String(s.weekday)}>{WEEKDAY_NAMES.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select>
        </label>
      ) : (
        <fieldset className="tpl-days"><legend>Days</legend>
          {WEEKDAYS.map((d, i) => <label key={d} className="inline"><input type="checkbox" name="weekdays" value={i + 1} defaultChecked={adding === i + 1} />{d}</label>)}
        </fieldset>
      )}
      {liveCodes.length > 0 && (
        <label>Shift type
          <select name="shiftCodeId" defaultValue={s?.shiftCodeId ?? ''}>
            <option value="">None (enter times)</option>
            {liveCodes.map(c => <option key={c.id} value={c.id}>{c.code}{c.name ? ` · ${c.name}` : ''} ({c.startTime}–{c.endTime})</option>)}
          </select>
        </label>
      )}
      <div className="tpl-times">
        <label>Start<input type="time" name="startTime" defaultValue={s?.startTime ?? ''} /></label>
        <label>Finish<input type="time" name="endTime" defaultValue={s?.endTime ?? ''} /></label>
      </div>
      <label>Break (minutes)<input type="number" name="breakMinutes" min={0} max={240} step={5} defaultValue={s ? String(s.breakMinutes) : ''} /></label>
      {liveCodes.length > 0 && <p className="muted small" style={{ margin: 0 }}>Leave the times blank to use the shift type&apos;s.</p>}
      <label>{tw.one(T.role)}
        <input name="role" list="tpl-roles" defaultValue={s && !s.equipmentOnly ? s.role : ''} maxLength={60} />
      </label>
      <datalist id="tpl-roles">{roleNames.map(r => <option key={r} value={r} />)}</datalist>
      <label>{tw.one(T.area)}
        <select name="areaId" defaultValue={s?.areaId ?? sp.area ?? ''}>
          <option value="">No {tw.lower(T.area)}</option>
          {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <label>Usual person (the T line)
        <select name="workerId" defaultValue={s?.workerId ?? ''}>
          <option value="">Nobody in particular</option>
          {s?.workerId && !people.some(p => p.id === s.workerId) && <option value={s.workerId}>{s.workerName} (not active)</option>}
          {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label>Gender requested
        <select name="genderRequested" defaultValue={s?.genderRequested ?? ''}>
          <option value="">No preference</option><option value="F">Female (F)</option><option value="M">Male (M)</option>
        </select>
      </label>
      {duties.some(d => d.active) && (
        <fieldset><legend>Duties</legend>
          {duties.filter(d => d.active).map(d => <label key={d.id} className="inline"><input type="checkbox" name="dutyIds" value={d.id} defaultChecked={s?.duties.some(x => x.id === d.id)} />{d.name}</label>)}
        </fieldset>
      )}
      {equipment.some(e => e.status !== 'retired') && (
        <fieldset><legend>{tw.one(T.equipment)}</legend>
          {equipment.filter(e => e.status !== 'retired').map(e => <label key={e.id} className="inline"><input type="checkbox" name="equipmentIds" value={e.id} defaultChecked={s?.equipmentList.some(x => x.id === e.id)} />{e.name}</label>)}
        </fieldset>
      )}
      <label className="inline"><input type="checkbox" name="equipmentOnly" defaultChecked={s?.equipmentOnly} />{tw.one(T.equipment)} only (nobody works it)</label>
      <label>Notes<textarea name="notes" rows={2} maxLength={1000} defaultValue={s?.notes ?? ''} /></label>
      <button className="btn">{s ? 'Save' : `Add ${tw.lower(T.shift, true)}`}</button>
    </form>
  );

  const card = (s: TemplateShift) => {
    const markers = shiftMarkers({
      genderRequested: s.genderRequested, equipment: s.equipmentList, duties: s.duties,
      usualWorkerId: s.workerId, usualName: s.workerName,
    }, letters).filter(m => m.key !== 't');
    return (
      <Link key={s.id} href={`${href({ slot: s.id })}#template-panel`} className={`tcard${s.id === editing?.id ? ' sel' : ''}`} title={`${s.startTime}–${s.endTime} ${s.role}${s.workerName ? ` · usually ${s.workerName}` : ''}`}>
        <span className="mkcol">
          <b className={`mk mk-shift ${({ A: 'am', P: 'pm', N: 'nd' } as const)[periodLetter(s.startTime)]}`}>{s.shiftLetter ?? periodLetter(s.startTime)}</b>
          {markers.map(m => <b key={m.key} className={`mk ${m.cls}`} title={m.title}>{m.letter}</b>)}
        </span>
        <span className="cbody">
          <span className="tm">{s.startTime}–{s.endTime}{s.shiftCode ? ` · ${s.shiftCode}` : ''}</span>
          <span className="rl">{s.role}</span>
          {!s.equipmentOnly && <span className={`tl${s.workerName ? '' : ' none'}`}><b className="mk mk-t">{letters.template}</b> {s.workerName ?? 'Nobody in particular'}</span>}
          {s.equipmentList.length > 0 && <span className="muted">+ {s.equipmentList.map(e => e.name).join(', ')}</span>}
        </span>
      </Link>
    );
  };

  return (
    <div className="tpl-page">
      <div className="roster-head">
        <div className="roster-title"><h1>{tw.one(T.roster)}</h1></div>
        <nav className="roster-stages" aria-label="Roster stages">
          <span className="on" aria-current="page">Template</span>
          <Link href={`/roster${site ? `?site=${site}` : ''}`}>Draft</Link>
          <Link href={`/roster${site ? `?site=${site}` : ''}`}>Live</Link>
          <Link href={`/roster${site ? `?site=${site}` : ''}`}>History</Link>
        </nav>
        {facilities.length > 1 && (
          <form method="get" action="/roster/template" className="tool-site">
            <AutoSelect name="site" value={site ?? ''} label={tw.one(T.site)} options={facilities} />
            <noscript><button className="btn small secondary">Show</button></noscript>
          </form>
        )}
        {templates.length > 1 && (
          <form method="get" action="/roster/template" className="tool-site">
            <input type="hidden" name="site" value={site ?? ''} />
            <AutoSelect name="template" value={chosenId ?? ''} label="Template" options={templates.map(t => ({ id: t.id, name: `${t.name} · ${tw.count(t.shifts, T.shift)}` }))} />
            <noscript><button className="btn small secondary">Open</button></noscript>
          </form>
        )}
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        A template is a usual week for {facility ? facility.name : `a ${tw.lower(T.site)}`}: who normally works each {tw.lower(T.shift)}, with its times, duties and {tw.lower(T.equipment)}.
        Fill a week from it and each {tw.lower(T.shift)} keeps its usual person on the T line, so you only change what&apos;s different.
      </p>
      <Notices error={sp.error} done={sp.done} />

      {!site && <div className="card"><p>Add a {tw.lower(T.site)} first, then make its templates here.</p></div>}

      {site && (
        <details className="card tpl-start" open={!tpl}>
          <summary>Start a template</summary>
          <div className="tpl-start-forms">
            <form action={startTemplate} className="form-row">
              <input type="hidden" name="site" value={site} />
              <h3>Empty, to fill in day by day</h3>
              <label>Name<input name="name" required maxLength={80} placeholder="e.g. Usual week" /></label>
              <button className="btn small">Start template</button>
            </form>
            <form action={startTemplate} className="form-row">
              <input type="hidden" name="site" value={site} />
              <h3>From a week on the {tw.lower(T.roster)}</h3>
              <label>Name<input name="name" required maxLength={80} placeholder="e.g. Week 2" /></label>
              <label>The week of<input type="date" name="weekStart" required defaultValue={addDays(mondayOf(todayIn(zone)), -7)} /></label>
              <label className="inline"><input type="checkbox" name="people" defaultChecked />Who works each {tw.lower(T.shift)}</label>
              <label className="inline"><input type="checkbox" name="equipment" defaultChecked />The {tw.lower(T.equipment)} on each</label>
              <button className="btn small secondary">Save as a template</button>
            </form>
          </div>
        </details>
      )}

      {tpl && (
        <div className="tpl-layout">
          <section className="card tpl-week" aria-label={`Template ${tpl.name}`}>
            <div className="tpl-week-head">
              <h2>{tpl.name} <span className="muted small">{tw.count(tpl.shifts, T.shift)}{tpl.withPeople ? `, ${tpl.withPeople} with a usual person` : ''}</span></h2>
              <details className="tool-menu">
                <summary>Template</summary>
                <div className="tool-menu-body tpl-menu">
                  <form action={renameTemplate} className="form-row">
                    {hidden}
                    <label>Name<input name="name" required maxLength={80} defaultValue={tpl.name} /></label>
                    <button className="btn small secondary">Rename</button>
                  </form>
                  <form action={putAwayTemplate}>
                    {hidden}
                    <button className="btn small secondary" title="Hides the template. Weeks already filled from it don't change.">Put away</button>
                  </form>
                </div>
              </details>
            </div>
            <div className="tpl-scroll">
              <div className="tpl-grid">
                <div className="tpl-corner">{tw.one(T.area)}</div>
                {WEEKDAYS.map((d, i) => (
                  <div key={d} className="tpl-day">{d}<span className="muted small">{totals[i].shifts ? `${tw.count(totals[i].shifts, T.shift)} · ${totals[i].hours} h` : '–'}</span></div>
                ))}
                {grid.map(r => (
                  <div key={r.key} className="tpl-row">
                    <div className="tpl-area">{r.label}</div>
                    {r.days.map((list, i) => (
                      <div key={i} className="tpl-cell">
                        {list.map(card)}
                        <Link className="tpl-add" href={`${href({ add: String(i + 1), area: r.areaId ?? undefined })}#template-panel`} aria-label={`Add a ${tw.lower(T.shift)} on ${WEEKDAY_NAMES[i]}${r.areaId ? ` in ${r.label}` : ''}`}>+</Link>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <form action={fillWeekFromTemplate} className="form-row tpl-fill">
              {hidden}
              <h3>Fill a week from this template</h3>
              <label>The week of<input type="date" name="week" required defaultValue={nextMonday} /></label>
              <label className="inline"><input type="checkbox" name="people" defaultChecked />Put the usual people on where they can work it</label>
              <label className="inline"><input type="checkbox" name="equipment" defaultChecked />Book the usual {tw.lower(T.equipment)}</label>
              <label className="inline"><input type="checkbox" name="addToExisting" />Add to the {tw.lower(T.shift, true)} already there</label>
              <button className="btn small">Fill week</button>
            </form>
          </section>

          <aside className="card tpl-panel" id="template-panel" aria-label={editing ? 'Change this template shift' : 'Add to the template'}>
            {editing ? (<>
              <div className="tpl-panel-head">
                <h2>{WEEKDAY_NAMES[editing.weekday - 1]} {editing.startTime}–{editing.endTime}</h2>
                <Link href={href()} className="small">Close</Link>
              </div>
              <p className="muted small" style={{ marginTop: 0 }}>Changes apply to weeks filled from now on. Weeks already filled don&apos;t change.</p>
              {shiftForm(editing)}
              <form action={removeTemplateShift.bind(null, editing.id)} style={{ marginTop: 12 }}>
                {hidden}
                <button className="btn small secondary">Take out of the template</button>
              </form>
            </>) : (<>
              <div className="tpl-panel-head">
                <h2>Add {tw.lower(T.shift, true)}</h2>
                {adding && <Link href={href()} className="small">Clear</Link>}
              </div>
              {shiftForm(null)}
            </>)}
          </aside>
        </div>
      )}
    </div>
  );
}
