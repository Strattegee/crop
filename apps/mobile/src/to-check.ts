/**
 * Credentials and right to work proof waiting for the office to check (backlog item 9a, 7 Nov), on the manager side's
 * Requests tab, which the office's "To check" phone alert opens. Pure helpers; the list is `GET /to-check` (office
 * roles), files open through the existing 5-minute links, and owners and admins check or don't accept through the
 * same endpoints as the person's page on the web.
 */

export interface ToCheckFile { id: string; filename: string; contentType: string }

export interface ToCheckItem {
  kind: 'credential' | 'right_to_work';
  id: string;
  workerId: string;
  workerName: string;
  title: string;
  lines: string[];
  files: ToCheckFile[];
}

/** "Ana Example · First aid". */
export function toCheckTitle(i: Pick<ToCheckItem, 'workerName' | 'title'>): string {
  return `${i.workerName} · ${i.title}`;
}

const base = (i: Pick<ToCheckItem, 'kind' | 'id' | 'workerId'>) =>
  i.kind === 'credential' ? `/workers/${i.workerId}/credentials/${i.id}` : `/workers/${i.workerId}/right-to-work`;

/** The endpoint giving a 5-minute link to one file. */
export function fileLinkPath(i: Pick<ToCheckItem, 'kind' | 'id' | 'workerId'>, fileId: string): string {
  return `${base(i)}/documents/${fileId}/link`;
}

/** The endpoint that checks it (`verify`) or doesn't accept it (`reject`, which needs a reason). */
export function decidePath(i: Pick<ToCheckItem, 'kind' | 'id' | 'workerId'>, answer: 'verify' | 'reject'): string {
  return `${base(i)}/${answer}`;
}

/** A reason is needed to not accept something (the person is shown it on their page). */
export function reasonProblem(reason: string): string | null {
  const r = reason.trim();
  if (!r) return 'Say why it isn’t accepted';
  if (r.length > 500) return 'Keep the reason under 500 characters';
  return null;
}

/** The message after deciding. */
export function checkedMessage(answer: 'verify' | 'reject', title: string): string {
  return answer === 'verify' ? `${title} checked. It counts now.` : `${title} not accepted. The reason is on their record.`;
}

/** "photo.png" with a short note when it's a PDF, so people know what will open. */
export function fileLabel(f: Pick<ToCheckFile, 'filename' | 'contentType'>): string {
  return f.contentType === 'application/pdf' ? `${f.filename} (PDF)` : f.filename;
}
