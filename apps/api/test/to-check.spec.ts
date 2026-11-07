import { describe, expect, it } from 'vitest';
import { checkWhat, sortToCheck, toCheckItem, toCheckLines, toCheckPush, viaOf, type ToCheckRow } from '../src/workforce/to-check.js';
import { pushScreen } from '../src/notifications/push.js';

const row = (o: Partial<ToCheckRow> = {}): ToCheckRow => ({
  kind: 'credential', id: 'c1', workerId: 'w1', workerName: 'Ana Example', workerStatus: 'active', typeName: 'First aid', category: 'training',
  number: null, issuedBy: null, issueDate: null, expiryDate: null, status: null, vevoCheckedOn: null, via: null, sentAt: '2026-11-01 09:00', files: [], ...o,
});

describe('things to check (backlog item 9a)', () => {
  it('words a credential with what was recorded and how it came', () => {
    expect(toCheckLines(row({ number: 'FA-1', issuedBy: 'Example Training', issueDate: '2026-01-02', expiryDate: '2029-01-02', via: 'link',
      files: [{ id: 'd', filename: 'a.pdf', contentType: 'application/pdf' }] }))).toEqual([
      'Ana Example · Sent by upload link', 'Number FA-1 · Issued by Example Training', 'Issued 2 Jan 2026 · Expires 2 Jan 2029', '1 file',
    ]);
    expect(toCheckLines(row({ workerStatus: 'onboarding', via: 'apply' }))).toEqual(['Ana Example (getting started) · Sent with their application', 'No files yet']);
    expect(toCheckLines(row({ workerStatus: 'applicant' }))[0]).toBe('Ana Example (applying) · Added by the office');
  });

  it('words right to work by status, with the VEVO check for non-citizens', () => {
    expect(toCheckLines(row({ kind: 'right_to_work', typeName: null, status: 'citizen', via: 'app' }))).toEqual(['Ana Example · Sent in the app', 'Australian citizen', 'No files yet']);
    expect(toCheckLines(row({ kind: 'right_to_work', typeName: null, status: 'visa_holder' }))).toContain('VEVO check not recorded yet');
    expect(toCheckItem(row({ kind: 'right_to_work', typeName: null })).title).toBe('Right to work');
    expect(toCheckItem(row()).title).toBe('First aid');
  });

  it('puts what has waited longest first, and reads how it came', () => {
    const list = sortToCheck([row({ id: 'b', sentAt: '2026-11-02' }), row({ id: 'a', sentAt: '2026-11-01' })]);
    expect(list.map(r => r.id)).toEqual(['a', 'b']);
    expect(viaOf('app')).toBe('app');
    expect(viaOf(undefined)).toBe('office');
    expect(viaOf('something')).toBe('office');
  });

  it('alerts the office without numbers or health details', () => {
    expect(checkWhat({ kind: 'credential', typeName: 'Flu vaccination', category: 'vaccination' })).toBe('a vaccination record');
    expect(checkWhat({ kind: 'right_to_work' })).toBe('proof of their right to work');
    expect(toCheckPush({ name: 'Ana Example', what: 'First aid', via: 'link' }))
      .toEqual({ title: 'To check: Ana Example', body: 'Ana Example sent First aid by upload link. Open CROP to check it.' });
    expect(pushScreen('office_to_check')).toBe('requests');
  });
});
