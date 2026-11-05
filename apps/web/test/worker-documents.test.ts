import { describe, expect, it } from 'vitest';
import { documentMeta, documentsIntro } from '../lib/worker-documents';

describe('documents on a person', () => {
  const when = (iso: string) => iso.slice(0, 10);
  it('describes a file', () => {
    expect(documentMeta({ contentType: 'application/pdf', sizeBytes: 120_000, source: 'office', uploadedAt: '2026-11-03T01:00:00Z' }, when))
      .toBe('PDF · 117 KB · added 2026-11-03');
    expect(documentMeta({ contentType: 'image/png', sizeBytes: 3 * 1024 * 1024, source: 'application', uploadedAt: '2026-11-04T01:00:00Z' }, when))
      .toBe('PNG · 3.0 MB · added 2026-11-04 · sent with their application');
    expect(documentMeta({ contentType: 'image/heic', sizeBytes: 10, source: 'office', uploadedAt: '2026-11-04T01:00:00Z' }, when)).toBe('HEIC · 1 KB · added 2026-11-04');
  });
  it('says how many are kept', () => {
    expect(documentsIntro(0, 'Sam')).toMatch(/^Nothing kept for Sam yet/);
    expect(documentsIntro(1, 'Sam')).toBe('1 document kept for Sam. Only the office sees them.');
    expect(documentsIntro(3, 'Sam')).toBe('3 documents kept for Sam. Only the office sees them.');
  });
});
