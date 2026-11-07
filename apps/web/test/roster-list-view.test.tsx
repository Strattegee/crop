import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }) }));
vi.mock('../app/(office)/roster/actions', () => ({ confirm: async () => {}, peopleForShifts: async () => ({ people: [] }) }));
vi.mock('../app/(office)/roster/list-actions', () => ({
  bulkAssign: async () => {}, bulkCancel: async () => {}, bulkConfirm: async () => {}, bulkDuty: async () => {}, bulkOffer: async () => {},
}));
const { ListView } = await import('../app/(office)/roster/list-view');
const { makeWords } = await import('../lib/term-words');
const { parseListParams } = await import('../lib/roster-list');
const { DEFAULT_MARKER_LETTERS } = await import('../lib/marker-letters');

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const shift = (n: number, over: object = {}) => ({
  id: ID(n), facilityId: ID(900), facilityName: 'North Site', areaName: 'Kitchen', role: 'Cook', status: 'open' as const,
  localDate: '2026-11-04', localStart: '07:00', localEnd: '15:00', hours: 7.5, workerId: null, workerName: null, ...over,
});

function render(sp: Record<string, string>, role = '') {
  const url = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ week: '2026-11-02', layout: 'list', ...sp, ...over })) if (v) q.set(k, v);
    return `/roster?${q.toString()}`;
  };
  return renderToStaticMarkup(
    <ListView shifts={[
      shift(1),
      shift(2, { status: 'booked', workerId: ID(50), workerName: 'Sam Example', role: 'Barista', areaName: 'Front', equipment: [{ name: 'Van 1', vehicle: true }] }),
      shift(3, { localStart: '22:00', localDate: '2026-11-05', hours: 9, facilityId: ID(901), facilityName: 'South Site' }),
    ]} p={parseListParams({ layout: 'list', ...sp })} role={role} tw={makeWords([])} letters={DEFAULT_MARKER_LETTERS} dayRequests={[]}
      url={url} here={url({})} selectedId={null} allSites weekDays={['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']}
      people={[]} duties={[]} blocked={new Map([[ID(1), 'Blocked: no licence']])} gaps={new Map()} refused={new Set()}
      stageLabel={() => 'Stage'} letterCol={() => null} closeHref={null} />,
  );
}
const rows = (html: string) => (html.match(/name="pick"/g) ?? []).length;

describe('roster list view: column filters', () => {
  it('puts a filter in every heading, joined to one form that keeps the rest of the URL', () => {
    const html = render({});
    for (const name of ['q', 'day', 'band', 'ap', 'fac', 'area', 'role', 'who', 'person', 'stage', 'len', 'mk', 'tl', 'warn']) {
      expect(html).toContain(`name="${name}"`);
    }
    expect(html).toContain('id="list-filters"');
    expect(html).toContain('<input type="hidden" name="week" value="2026-11-02"/>');
    expect(html).toContain('Sort by hours');
    expect(rows(html)).toBe(3);
    expect(html).not.toContain('Clear filters');
  });
  it('filters the rows, keeps the chips counting without the stage, and offers Clear filters', () => {
    const html = render({ mk: 'vehicle' });
    expect(rows(html)).toBe(1);
    expect(html).toContain('Clear filters');
    expect(html).toContain('1 of 3 shifts');
    expect(render({ warn: 'blocked' })).toContain('1 of 3 shifts');
    expect(rows(render({ band: 'night' }))).toBe(1);
    expect(rows(render({ fac: ID(901) }))).toBe(1);
    const staged = render({ stage: 'booked' });
    expect(rows(staged)).toBe(1);
    expect(staged).toMatch(/Unfilled only <b>2<\/b>/);
  });
  it('takes several roles in the strip\'s role filter', () => {
    expect(rows(render({}, 'Cook,Barista'))).toBe(3);
    expect(rows(render({}, 'Barista'))).toBe(1);
  });
  it('moves a grouped-away column\'s filter onto the bar', () => {
    const html = render({ group: 'area' });
    expect(html).toContain('class="lst-barf"');
    expect(html).toContain('name="area"');
  });
});

describe('roster list view: dragging from the strip (7 Nov)', () => {
  it('marks each row as a drop target like the cards: people only on unfilled rows', () => {
    const html = render({});
    expect(html).toContain(`data-shift="${ID(1)}"`);
    expect(html).toMatch(new RegExp(`data-shift="${ID(1)}"[^>]*data-needs-person="1"[^>]*data-takes-equipment="1"`));
    expect(html).toMatch(new RegExp(`data-shift="${ID(2)}"[^>]*data-needs-person="0"[^>]*data-takes-equipment="1"[^>]*data-worker="${ID(50)}"[^>]*data-worker-name="Sam Example"`));
    expect(html).toMatch(new RegExp(`data-shift="${ID(1)}"[^>]*data-href="/roster\\?[^"]*shift=${ID(1)}`));
  });
  it('offers the strip beside the list, and hides it again', () => {
    expect(render({})).toMatch(/lst-striplink[^>]*href="[^"]*strip=1"[^>]*>Show workers to drag/);
    const on = render({ strip: '1' });
    expect(on).toContain('Hide workers to drag');
    expect(on).toContain('<input type="hidden" name="strip" value="1"/>');
  });
});
