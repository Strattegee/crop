import { describe, expect, it } from 'vitest';
import { checkedMessage, decidePath, fileLabel, fileLinkPath, reasonProblem, toCheckTitle } from '../src/to-check';

const cred = { kind: 'credential' as const, id: 'c1', workerId: 'w1' };
const rtw = { kind: 'right_to_work' as const, id: 'r1', workerId: 'w1' };

describe('to check in manager mode (backlog item 9a)', () => {
  it('names each thing with the person', () => {
    expect(toCheckTitle({ workerName: 'Ana Example', title: 'First aid' })).toBe('Ana Example · First aid');
  });

  it('uses the same endpoints as the web for files and decisions', () => {
    expect(fileLinkPath(cred, 'd1')).toBe('/workers/w1/credentials/c1/documents/d1/link');
    expect(fileLinkPath(rtw, 'd2')).toBe('/workers/w1/right-to-work/documents/d2/link');
    expect(decidePath(cred, 'verify')).toBe('/workers/w1/credentials/c1/verify');
    expect(decidePath(rtw, 'reject')).toBe('/workers/w1/right-to-work/reject');
  });

  it('needs a reason to not accept, and says what happened', () => {
    expect(reasonProblem('  ')).toBe('Say why it isn’t accepted');
    expect(reasonProblem('x'.repeat(501))).toBe('Keep the reason under 500 characters');
    expect(reasonProblem('Photo is blurry')).toBeNull();
    expect(checkedMessage('verify', 'First aid')).toBe('First aid checked. It counts now.');
    expect(checkedMessage('reject', 'Right to work')).toBe('Right to work not accepted. The reason is on their record.');
    expect(fileLabel({ filename: 'a.pdf', contentType: 'application/pdf' })).toBe('a.pdf (PDF)');
    expect(fileLabel({ filename: 'a.png', contentType: 'image/png' })).toBe('a.png');
  });
});
