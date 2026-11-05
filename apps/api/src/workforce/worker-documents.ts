/**
 * Documents kept on a person's record (migration 0096): a CV, a signed contract or another document the office keeps.
 * Pure rules and wording, tested in test/worker-documents.spec.ts.
 */
export const DOCUMENT_KINDS = ['cv', 'contract', 'other'] as const;
export type DocumentKind = typeof DOCUMENT_KINDS[number];

export const KIND_LABEL: Record<DocumentKind, string> = { cv: 'CV', contract: 'Contract', other: 'Other document' };

/** Most files a person's record keeps at once (removed ones don't count). */
export const MAX_DOCUMENTS = 50;

export type DocumentFields = { kind: DocumentKind; title: string | null };

/** Reads the upload's kind and title (multipart fields arrive as strings). Returns a plain message when they're wrong. */
export function parseDocumentFields(body: Record<string, unknown>): DocumentFields | { problem: string } {
  const kind = typeof body.kind === 'string' && body.kind ? body.kind : 'other';
  if (!(DOCUMENT_KINDS as readonly string[]).includes(kind)) return { problem: 'Choose what kind of document it is' };
  const raw = typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim() : '';
  if (raw.length > 120) return { problem: 'Keep the name of the document to 120 characters' };
  if (kind === 'other' && !raw) return { problem: 'Say what the document is' };
  return { kind: kind as DocumentKind, title: raw || null };
}

/** The line a document shows under: its title, else what kind it is ("CV", "Contract"). */
export function documentLabel(d: { kind: string; title: string | null }): string {
  return d.title ?? KIND_LABEL[d.kind as DocumentKind] ?? 'Document';
}

/** Why a person can't have another document, or null. */
export function documentRefusal(w: { status: string } | undefined, kept: number): string | null {
  if (!w) return 'Person not found';
  if (w.status === 'agency') return "An agency's people are the agency's to keep documents for";
  if (kept >= MAX_DOCUMENTS) return `A record keeps up to ${MAX_DOCUMENTS} documents. Remove one you no longer need first.`;
  return null;
}
