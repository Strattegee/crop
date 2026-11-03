import Link from 'next/link';
import { api } from '../../../../lib/api';
import { liveHref, liveQuery, parseLiveParams, percentLine, periodDates, scopeLine, type LiveMeasure, type LiveNumbers, type LiveParams } from '../../../../lib/live-numbers';
import { T, words, type Words } from '../../../../lib/terms';
import { LiveRefresh } from './live-refresh';

export const dynamic = 'force-dynamic';

/**
 * Live numbers (David, 3 Nov 2026, answer 1): {client} requests and how they ended up, each allocation officer's work
 * and each person's {shifts}, for a period, the whole business, a state or an office. Numbers with percentages of
 * requests; definitions on hover (the API's `LIVE`). Refreshes itself while open.
 */
export default async function LiveNumbersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [tw, sp] = await Promise.all([words(), searchParams]);
  const p = parseLiveParams(sp);
  const l = await api<LiveNumbers>(`/dashboard/live?${liveQuery(p)}`).catch(() => null);
  const requests = `${tw.lower(T.client)} requests`;
  return (
    <div className="live-page">
      <p className="muted small" style={{ margin: 0 }}><Link href="/dashboard">Dashboard</Link> ›</p>
      <div className="dash-head">
        <h1>Live numbers</h1>
        {l && <LiveRefresh at={l.at} />}
        <nav className="dash-switch" aria-label="Period">
          {(l?.periods ?? []).map(x => (
            <Link key={x.period} href={liveHref(p, { period: x.period })} className={x.period === p.period ? 'on' : ''} aria-current={x.period === p.period ? 'page' : undefined}>{x.label}</Link>
          ))}
        </nav>
      </div>
      {!l ? <p className="notice error">Couldn&apos;t load the numbers. They try again in a moment.</p> : (<>
        <p className="live-scope">
          <strong>{scopeLine(l)}</strong> · {l.periodLabel} ({periodDates(l.from, l.to)})
          {(l.state || l.office) && <> · <Link href={liveHref(p, { state: null, office: null })}>Whole business</Link></>}
        </p>
        <Drill tw={tw} l={l} p={p} />

        <section className="live-section" aria-labelledby="live-shifts">
          <h2 id="live-shifts">{tw.many(T.shift)}</h2>
          <Tiles list={l.shifts} requests={requests} />
          {l.shifts[0].value === 0 && <p className="muted small">No {requests} start in this period{l.state || l.office ? ' here' : ''}.</p>}
        </section>

        <section className="live-section" aria-labelledby="live-officers">
          <h2 id="live-officers">Allocation officers</h2>
          <Tiles list={l.officers.measures} requests={requests} />
          {l.officers.rows.length === 0 ? <p className="muted small">Nobody in the office {l.office || l.state ? 'works for this office yet (Settings › Offices).' : 'yet.'}</p> : (
            <div className="live-table-wrap">
              <table className="live-table">
                <thead><tr><th>Officer</th>{l.officers.measures.map(m => <th key={m.key} title={m.how} className="num">{m.label}</th>)}</tr></thead>
                <tbody>
                  {l.officers.rows.map(r => (
                    <tr key={r.userId}><td>{r.name}</td><td className="num">{r.handled}</td><td className="num">{r.messages}</td><td className="num">{r.calls}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="live-section" aria-labelledby="live-people">
          <h2 id="live-people">{tw.many(T.worker)}</h2>
          <Tiles list={l.personnel.measures} requests={requests} />
          {l.personnel.rows.length === 0 ? <p className="muted small">Nobody booked or pulled out in this period{l.state || l.office ? ' here' : ''}.</p> : (
            <div className="live-table-wrap">
              <table className="live-table">
                <thead><tr><th>{tw.one(T.worker)}</th>{l.personnel.measures.map(m => <th key={m.key} title={m.how} className="num">{m.label}</th>)}</tr></thead>
                <tbody>
                  {l.personnel.rows.map(r => (
                    <tr key={r.workerId}>
                      <td><Link href={`/workers/${r.workerId}`}>{r.name}</Link></td>
                      <td className="num">{r.accepted}</td><td className="num">{r.worked}</td><td className={`num${r.pulledOut ? ' bad' : ''}`}>{r.pulledOut}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {l.personnel.more > 0 && <p className="muted small">and {l.personnel.more} more</p>}
            </div>
          )}
        </section>
        <p className="muted small">Hover over a heading or number for how it is worked out. Dates are each {tw.lower(T.site)}&apos;s local dates; times in the office use your business&apos;s time zone.</p>
      </>)}
    </div>
  );
}

/** The drill-down: state chips, then office chips (narrowed to the state chosen). */
function Drill({ tw, l, p }: { tw: Words; l: LiveNumbers; p: LiveParams }) {
  return (
    <div className="live-drill">
      {l.states.length > 0 && (
        <nav className="q-chips" aria-label="State">
          <span className="muted small">State:</span>
          <Link className={`q-chip${p.state ? '' : ' on'}`} href={liveHref(p, { state: null, office: null })} scroll={false}>All</Link>
          {l.states.map(s => (
            <Link key={s.name} className={`q-chip${p.state === s.name ? ' on' : ''}`} href={liveHref(p, { state: s.name, office: null })} scroll={false}
              title={`${s.requests} ${tw.lower(T.client)} requests`}>{s.name} <b>{s.requests}</b></Link>
          ))}
        </nav>
      )}
      {l.offices.length > 0 && (
        <nav className="q-chips" aria-label="Office">
          <span className="muted small">Office:</span>
          <Link className={`q-chip${p.office ? '' : ' on'}`} href={liveHref(p, { office: null })} scroll={false}>All</Link>
          {l.offices.map(o => (
            <Link key={o.id} className={`q-chip${p.office === o.id ? ' on' : ''}`} href={liveHref(p, { office: o.id })} scroll={false}>{o.name} <b>{o.requests}</b></Link>
          ))}
          <Link className={`q-chip${p.office === 'none' ? ' on' : ''}`} href={liveHref(p, { office: 'none' })} scroll={false}>No office</Link>
        </nav>
      )}
    </div>
  );
}

function Tiles({ list, requests }: { list: LiveMeasure[]; requests: string }) {
  return (
    <div className="kpi-row">
      {list.map(m => (
        <div key={m.key} className="kpi" title={`${m.how}.`}>
          <span className="kpi-label">{m.label}</span>
          <span className="kpi-value">{m.value}</span>
          {percentLine(m, requests) && <span className="kpi-detail">{percentLine(m, requests)}</span>}
        </div>
      ))}
    </div>
  );
}
