/**
 * Documents kept on a person's record (Documents tab): a CV, a contract or another document. Pure, tested.
 * Keep the kinds in step with the API's `workforce/worker-documents.ts`.
 */
export type WorkerDocument = {
  id: string; kind: 'cv' | 'contract' | 'other'; title: string | null; label: string; filename: string;
  contentType: string; sizeBytes: number; source: 'office' | 'application'; uploadedAt: string;
};

export const DOCUMENT_KIND_CHOICES = [
  { value: 'cv', label: 'CV' },
  { value: 'contract', label: 'Contract' },
  { value: 'other', label: 'Other (say what it is)' },
] as const;

const TYPE_WORD: Record<string, string> = { 'application/pdf': 'PDF', 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/heic': 'HEIC' };

/** "PDF · 120 KB · added 3 Nov 2026 · sent with their application". `when` formats the timestamp in the business's zone. */
export function documentMeta(d: Pick<WorkerDocument, 'contentType' | 'sizeBytes' | 'source' | 'uploadedAt'>, when: (iso: string) => string): string {
  const size = d.sizeBytes >= 1024 * 1024 ? `${(d.sizeBytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(d.sizeBytes / 1024))} KB`;
  return [TYPE_WORD[d.contentType] ?? 'File', size, `added ${when(d.uploadedAt)}`, d.source === 'application' ? 'sent with their application' : null]
    .filter(Boolean).join(' · ');
}

/** The heading line under the card's title. */
export function documentsIntro(count: number, first: string): string {
  if (!count) return `Nothing kept for ${first} yet. Keep a CV, a signed contract or another document here; only the office sees them.`;
  return `${count === 1 ? '1 document' : `${count} documents`} kept for ${first}. Only the office sees them.`;
}
