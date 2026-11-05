import { describe, expect, it } from 'vitest';
import {
  anyFilter, clearedHref, docsLine, docsPercent, listQuery, parsePicks, parseRecruitParams, pickValue, placeLine, recruitHref, shortDate,
  showingLine, sortHref, sortMark, stageChips, waitLine, workLine,
} from '../lib/recruitment-list';

describe('recruitment list URL (David, 5 Nov)', () => {
  it('reads comma lists and repeated tick boxes, ignoring the unknown', () => {
    const p = parseRecruitParams({ stage: ['applied', 'screening,nope'], role: 'Carer,Nurse', work: 'casual,weekly', docs: 'odd', waiting: '7', sort: '-applied', limit: '300' });
    expect(p).toMatchObject({ stages: ['applied', 'screening'], roles: ['Carer', 'Nurse'], work: ['casual'], docs: '', waiting: '7', sort: 'applied', desc: true, limit: 300 });
    expect(parseRecruitParams({}).limit).toBe(100);
    expect(parseRecruitParams({ sort: '-default' })).toMatchObject({ sort: 'default', desc: false });
  });

  it('writes only what differs, and starts paging again', () => {
    const p = parseRecruitParams({ stage: 'applied', role: 'Carer', limit: '200', km: '25' });
    expect(recruitHref(p)).toBe('/recruitment?stage=applied&role=Carer');
    expect(recruitHref(p, { limit: 300 })).toBe('/recruitment?stage=applied&role=Carer&limit=300');
    expect(listQuery(parseRecruitParams({}))).toBe('?limit=100');
    expect(listQuery(parseRecruitParams({ near: 'x', km: '25' }))).toBe('?near=x&km=25&limit=100');
    expect(anyFilter(p)).toBe(true);
    expect(clearedHref(p)).toBe('/recruitment?stage=applied');
    expect(anyFilter(parseRecruitParams({ stage: 'offer' }))).toBe(false);
  });

  it('sorts by a heading, turning round on a second click', () => {
    const p = parseRecruitParams({});
    expect(sortHref(p, 'name')).toBe('/recruitment?sort=name');
    expect(sortHref(p, 'applied')).toBe('/recruitment?sort=-applied');
    const byName = parseRecruitParams({ sort: 'name' });
    expect(sortHref(byName, 'name')).toBe('/recruitment?sort=-name');
    expect(sortMark(byName, 'name')).toBe(' ↑');
    expect(sortMark(byName, 'docs')).toBe('');
  });

  it('chips: in progress by default, new applications, then each stage', () => {
    const counts = { applied: 4, screening: 2, interview: 0, offer: 1, onboarding: 3, started: 5, not_proceeding: 9 };
    const chips = stageChips(parseRecruitParams({}), counts);
    expect(chips.map(c => [c.label, c.count, c.on])).toEqual([
      ['In progress', 10, true], ['New applications', 4, false], ['Screening', 2, false], ['Interview', 0, false], ['Offer', 1, false],
      ['Onboarding', 3, false], ['Started', 5, false], ['Not proceeding', 9, false],
    ]);
    const onNew = stageChips(parseRecruitParams({ stage: 'applied' }), counts);
    expect(onNew.find(c => c.on)?.key).toBe('new');
    expect(onNew[0].href).toBe('/recruitment');
  });
});

describe('recruitment list wording', () => {
  it('words documents, work, place and waiting', () => {
    expect(docsLine({ done: 3, total: 5, toCheck: 1, missing: 1 })).toBe('3 of 5 · 1 to check');
    expect(docsPercent({ done: 1, total: 4, toCheck: 0, missing: 3 })).toBe(25);
    expect(workLine(['casual', 'part_time'])).toBe('Casual, Part-time');
    expect(workLine([])).toBe('–');
    expect(placeLine({ suburb: 'Geelong', region: 'VIC', postcode: '3220', distanceKm: 12.4 })).toBe('Geelong VIC 3220 · 12 km');
    expect(placeLine({ suburb: null, region: null, postcode: null })).toBe('–');
    expect(waitLine('applied', 0)).toBe('New today');
    expect(waitLine('screening', 4)).toBe('4 days in Screening');
    expect(waitLine('onboarding', 1)).toBe('Onboarding for 1 day');
    expect(waitLine('started', 3)).toBe('Started 3 days ago');
    expect(showingLine(100, 1240, n => `${n.toLocaleString('en-AU')} people`)).toBe('Showing 100 of 1,240 people');
    expect(showingLine(3, 3, n => `${n} people`)).toBe('3 people');
  });

  it('dates in the business zone, with the year only when it is not this year', () => {
    expect(shortDate('2026-11-04T20:00:00Z', 'Australia/Melbourne', '2026-11-05')).toBe('5 Nov');
    expect(shortDate('2025-11-04T20:00:00Z', 'Australia/Melbourne', '2026-11-05')).toBe('5 Nov 2025');
    expect(shortDate(null, 'Australia/Melbourne', '2026-11-05')).toBe('–');
  });

  it('carries what the bulk actions need in each tick box', () => {
    const id = '0b7c2a4e-1111-4222-8333-444455556666';
    const v = pickValue({ id, firstName: 'Ana', lastName: 'Ex|ample', preferredName: null, email: null, stage: 'onboarding', onboardingId: 'ob1' });
    expect(parsePicks([v, v, 'nonsense'])).toEqual([{ id, name: 'Ana Ex ample', hasEmail: false, stage: 'onboarding', onboardingId: 'ob1' }]);
  });
});
