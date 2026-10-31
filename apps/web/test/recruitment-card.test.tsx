import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../app/(office)/recruitment/actions', () => ({
  moveFrom: async () => {}, startOnboardingFrom: async () => {}, dropOnStage: async () => {},
}));
const { RecruitmentCard } = await import('../app/(office)/workers/[id]/recruitment-card');
const { BoardDrag } = await import('../app/(office)/recruitment/board-drag');

const when = (iso: string) => iso.slice(0, 10);
const events = [
  { at: '2026-10-20T01:00:00Z', toStage: 'applied', fromStage: null, byName: 'Office Example', note: null },
  { at: '2026-10-22T01:00:00Z', toStage: 'interview', fromStage: 'applied', byName: 'Office Example', note: 'Phone screen went well' },
];

describe('recruitment on the person page', () => {
  it('shows the stage, the moves newest first and the next steps for an applicant', () => {
    const html = renderToStaticMarkup(
      <RecruitmentCard workerId="w1" status="applicant" stage="interview" events={events} checklists={[]} when={when} />);
    expect(html).toContain('Recruitment <span class="muted small">· Interview');
    expect(html.indexOf('Moved to Interview')).toBeLessThan(html.indexOf('>Applied<'));
    expect(html).toContain('Phone screen went well');
    expect(html).toContain('Offer →');
    expect(html).toContain('← Back to Screening');
    expect(html).toContain('Not proceeding');
    expect(html).not.toContain('Reopen');
  });
  it('offers reopening to someone not proceeding, and nothing to people who never went through recruitment', () => {
    const np = renderToStaticMarkup(<RecruitmentCard workerId="w1" status="inactive" stage="interview"
      events={[...events, { at: '2026-10-23T01:00:00Z', toStage: 'not_proceeding', fromStage: 'interview', byName: null, note: null }]} checklists={[]} when={when} />);
    expect(np).toContain('Reopen');
    expect(np).toContain('Not proceeding (was at Interview)');
    expect(np).not.toContain('Offer →');
    expect(renderToStaticMarkup(<RecruitmentCard workerId="w1" status="active" stage={null} events={[]} checklists={[]} when={when} />)).toBe('');
  });
  it('lets Offer start onboarding with a checklist', () => {
    const html = renderToStaticMarkup(<RecruitmentCard workerId="w1" status="applicant" stage="offer" events={events}
      checklists={[{ id: 'c1', name: 'Kitchen starter' }]} when={when} />);
    expect(html).toContain('Kitchen starter');
    expect(html).toContain('Start onboarding →');
  });
  it('wraps the board for drag and drop', () => {
    expect(renderToStaticMarkup(<BoardDrag><section className="rcol" data-stage="applied" /></BoardDrag>))
      .toBe('<div class="rboard"><section class="rcol" data-stage="applied"></section></div>');
  });
});
