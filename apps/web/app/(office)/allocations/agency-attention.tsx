import Link from 'next/link';

export type AgencyKind = 'person_blocked' | 'open' | 'link_matching' | 'awaiting_employer';
export type AgencyAttention = {
  days: number; total: number; urgent: number; truncated: boolean; byKind: Record<AgencyKind, number>;
  items: {
    kind: AgencyKind; requestId: string | null; connectionId: string | null; urgent: boolean; title: string; detail: string; startsIn: string | null;
    request: { id: string; employerName: string; siteName: string; areaName: string | null; role: string; when: string; status: string; placedName: string | null } | null;
  }[];
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Needs attention on the agency's side (`GET /allocations/attention`): for the top of Allocations (everything) and the
 * Dashboard (the first few). `shiftsWord` is the business's word.
 */
export function AgencyAttentionList({ a, shown, shiftsWord, onAllocations }: {
  a: AgencyAttention; shown: number; shiftsWord: string; onAllocations: boolean;
}) {
  const kinds: { kind: AgencyKind; text: (n: number) => string }[] = [
    { kind: 'person_blocked', text: n => `${plural(n, 'person', 'people')} you put forward who can't go now` },
    { kind: 'open', text: n => `${plural(n, 'request', 'requests')} with nobody put forward` },
    { kind: 'link_matching', text: n => `${plural(n, 'employer', 'employers')} waiting for you to match their requirements` },
    { kind: 'awaiting_employer', text: n => `${plural(n, 'person', 'people')} waiting for the employer's approval` },
  ];
  if (a.total === 0) return <p className="muted">Nothing in Allocations needs you in the next {a.days} days.</p>;
  return (
    <>
      <p>
        {plural(a.total, 'thing', 'things')} in the next {a.days} days
        {a.urgent > 0 && <> · <strong className="bad">{a.urgent} within a day</strong></>}
      </p>
      <ul className="dash-kinds">
        {kinds.filter(k => a.byKind?.[k.kind]).map(k => (
          <li key={k.kind}><span className={`att-kind ${k.kind}`} aria-hidden="true" />{k.text(a.byKind[k.kind])}</li>
        ))}
      </ul>
      <ol>
        {a.items.slice(0, shown).map(i => (
          <li key={`${i.kind}:${i.requestId ?? i.connectionId}`}>
            <span className={`att-kind ${i.kind}`} aria-hidden="true" />
            <span>
              <strong>{i.title}</strong> <span className="muted">· {i.detail}</span>
              <br />
              {i.request ? (
                <>
                  <Link href={`${onAllocations ? '' : '/allocations'}#request-${i.request.id}`}>{i.request.role}, {i.request.when}</Link>
                  <span className="muted"> · {[i.request.areaName, i.request.siteName].filter(Boolean).join(', ')} · {i.request.employerName}</span>
                </>
              ) : i.connectionId ? (
                <Link href={`/settings/agencies/${i.connectionId}`}>Match requirements</Link>
              ) : null}
              {i.startsIn && <span className={i.urgent ? 'bad small' : 'muted small'}> · {i.startsIn}</span>}
            </span>
          </li>
        ))}
      </ol>
      {a.total > shown && <p className="muted small">And {a.total - shown} more{onAllocations ? '' : ' on Allocations'}; the most pressing are shown first.</p>}
      {a.truncated && <p className="muted small">Only the first 100 {shiftsWord} were checked.</p>}
    </>
  );
}
