import { describe, expect, it } from 'vitest';
import { credentialStatus, optionalFor, rightToWorkIssue, todayIn, workerCompliance, type CredentialFacts, type RequirementRule, type RightToWorkFacts } from '../src/workforce/compliance.js';

const police: RequirementRule = { credentialTypeId: 'police', typeName: 'Police check', scope: 'all_workers', role: null, severity: 'hard' };
const ahpra: RequirementRule = { credentialTypeId: 'ahpra', typeName: 'AHPRA', scope: 'role', role: 'RN', severity: 'hard' };
const flu: RequirementRule = { credentialTypeId: 'flu', typeName: 'Flu vaccination', scope: 'all_workers', role: null, severity: 'warning' };
const cred = (id: string, type: string, expiryDate: string | null, verification: CredentialFacts['verification'] = 'verified'): CredentialFacts =>
  ({ id, credentialTypeId: type, expiryDate, verification });
const TODAY = '2026-11-01';

describe('credential status', () => {
  it('is valid, expiring within the window, or expired after its expiry date', () => {
    expect(credentialStatus(null, TODAY, 30)).toBe('valid');
    expect(credentialStatus('2027-01-01', TODAY, 30)).toBe('valid');
    expect(credentialStatus('2026-12-01', TODAY, 30)).toBe('expiring');
    expect(credentialStatus('2026-11-01', TODAY, 30)).toBe('expiring'); // still valid on its expiry date
    expect(credentialStatus('2026-10-31', TODAY, 30)).toBe('expired');
  });

  it('uses the agency time zone for today', () => {
    // 1pm UTC on 31 Oct is 12am 1 Nov in Melbourne (daylight saving).
    expect(todayIn('Australia/Melbourne', new Date('2026-10-31T13:00:00Z'))).toBe('2026-11-01');
    expect(todayIn('Australia/Perth', new Date('2026-10-31T13:00:00Z'))).toBe('2026-10-31');
  });
});

describe('worker compliance', () => {
  it('is compliant when every hard requirement has a verified, current credential', () => {
    const r = workerCompliance(['RN'], [police, ahpra], [cred('1', 'police', '2028-01-01'), cred('2', 'ahpra', '2027-05-31')], TODAY, 30);
    expect(r).toEqual({ status: 'compliant', issues: [] });
  });

  it('only applies role rules to workers with that role', () => {
    const r = workerCompliance(['AIN'], [police, ahpra], [cred('1', 'police', null)], TODAY, 30);
    expect(r.status).toBe('compliant');
  });

  it('is non-compliant when a hard credential is missing, rejected, expired or unverified', () => {
    expect(workerCompliance([], [police], [], TODAY, 30).issues[0].problem).toBe('missing');
    expect(workerCompliance([], [police], [{ ...cred('1', 'police', null), verification: 'rejected' }], TODAY, 30).issues[0].problem).toBe('rejected');
    expect(workerCompliance([], [police], [cred('1', 'police', '2026-10-01')], TODAY, 30).issues[0].problem).toBe('expired');
    const unverified = workerCompliance([], [police], [cred('1', 'police', '2028-01-01', 'unverified')], TODAY, 30);
    expect(unverified).toMatchObject({ status: 'non_compliant', issues: [{ problem: 'unverified', severity: 'hard' }] });
  });

  it('is expiring when a required credential expires within the window', () => {
    const r = workerCompliance([], [police], [cred('1', 'police', '2026-11-20')], TODAY, 30);
    expect(r).toMatchObject({ status: 'expiring', issues: [{ problem: 'expiring', credentialId: '1' }] });
  });

  it('reports warnings without making the worker non-compliant', () => {
    const r = workerCompliance([], [police, flu], [cred('1', 'police', null)], TODAY, 30);
    expect(r).toMatchObject({ status: 'compliant', issues: [{ typeName: 'Flu vaccination', severity: 'warning', problem: 'missing' }] });
  });

  it('uses the best credential: a verified renewal beats an older or unverified one', () => {
    const r = workerCompliance([], [police], [
      cred('old', 'police', '2026-10-01'),
      cred('new', 'police', '2029-10-01'),
      cred('pending', 'police', '2030-10-01', 'unverified'),
    ], TODAY, 30);
    expect(r.status).toBe('compliant');
  });

  it('checks against a future shift date (CRD-8)', () => {
    const creds = [cred('1', 'police', '2026-12-10')];
    expect(workerCompliance([], [police], creds, TODAY, 0).status).toBe('compliant');
    expect(workerCompliance([], [police], creds, '2026-12-15', 0).status).toBe('non_compliant');
  });

  it('lets a hard rule win when the same type is also a warning', () => {
    const r = workerCompliance(['RN'], [{ ...ahpra, severity: 'warning', scope: 'all_workers', role: null }, ahpra], [], TODAY, 30);
    expect(r).toMatchObject({ status: 'non_compliant', issues: [{ severity: 'hard', problem: 'missing' }] });
  });
});

describe('right to work', () => {
  const rtw = (over: Partial<RightToWorkFacts>): RightToWorkFacts =>
    ({ id: 'r1', status: 'citizen', verification: 'verified', visaExpiry: null, vevoConfirmed: false, ...over });
  const problem = (r: RightToWorkFacts | null, on = TODAY) => rightToWorkIssue(r, on, 30)?.problem ?? null;

  it('is missing when nothing is recorded', () => expect(problem(null)).toBe('missing'));
  it('accepts a verified citizen without VEVO', () => expect(problem(rtw({}))).toBeNull());
  it('needs a confirmed VEVO check for everyone else', () => {
    expect(problem(rtw({ status: 'permanent_resident' }))).toBe('no_work_rights');
    expect(problem(rtw({ status: 'nz_citizen', vevoConfirmed: true }))).toBeNull();
  });
  it('checks the visa expiry, including against a future shift date', () => {
    const visa = rtw({ status: 'visa_holder', vevoConfirmed: true, visaExpiry: '2026-11-20' });
    expect(problem(visa)).toBe('expiring');
    expect(problem(visa, '2026-11-21')).toBe('expired');
    expect(problem({ ...visa, visaExpiry: '2027-06-30' })).toBeNull();
  });
  it('must be verified, and a rejection blocks', () => {
    expect(problem(rtw({ verification: 'unverified' }))).toBe('unverified');
    expect(problem(rtw({ verification: 'rejected' }))).toBe('rejected');
  });
  it('makes the worker non-compliant when included', () => {
    expect(workerCompliance([], [], [], TODAY, 30, null)).toMatchObject({ status: 'non_compliant', issues: [{ typeName: 'Right to work', problem: 'missing' }] });
    expect(workerCompliance([], [], [], TODAY, 30, rtw({})).status).toBe('compliant');
  });
});

describe('optional requirements', () => {
  const firstAid: RequirementRule = { credentialTypeId: 'firstaid', typeName: 'First aid', scope: 'role', role: 'RN', severity: 'optional' };
  const policeOptional: RequirementRule = { ...police, severity: 'optional' };

  it('are never checked or warned about', () => {
    expect(workerCompliance(['RN'], [firstAid, policeOptional], [], TODAY, 30)).toEqual({ status: 'compliant', issues: [] });
    expect(workerCompliance(['RN'], [firstAid], [cred('1', 'firstaid', '2026-01-01', 'unverified')], TODAY, 30).issues).toEqual([]);
  });

  it('do not soften a stronger rule for the same credential', () => {
    const r = workerCompliance(['RN'], [policeOptional, police], [], TODAY, 30);
    expect(r.issues.map(i => `${i.typeName}:${i.severity}`)).toEqual(['Police check:hard']);
  });

  it('are listed for the roles they apply to, with whether a current one is held', () => {
    expect(optionalFor(['AIN'], [firstAid], [], TODAY)).toEqual([]);
    expect(optionalFor(['RN'], [firstAid], [], TODAY)).toEqual([{ credentialTypeId: 'firstaid', typeName: 'First aid', held: false }]);
    expect(optionalFor(['RN'], [firstAid], [cred('1', 'firstaid', '2027-01-01', 'unverified')], TODAY)[0].held).toBe(true);
    expect(optionalFor(['RN'], [firstAid], [cred('1', 'firstaid', '2026-10-31')], TODAY)[0].held).toBe(false);
    expect(optionalFor(['RN'], [firstAid], [cred('1', 'firstaid', null, 'rejected')], TODAY)[0].held).toBe(false);
    // Asked for more strongly elsewhere: shown as an issue or met, not as optional.
    expect(optionalFor(['RN'], [policeOptional, police], [], TODAY)).toEqual([]);
  });
});
