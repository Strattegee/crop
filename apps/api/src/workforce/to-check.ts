/**
 * Things for the office to check (backlog item 9a, 7 Nov: "alerts for credentials and right-to-work proof to check
 * ... would need a place in the app to check them"). Credentials not yet checked and right to work details not yet
 * checked, for active people and people still applying or getting started, oldest first. Pure shaping and wording;
 * the data comes from `to-check.controller.ts`. Verifying and rejecting stay the existing owner/admin endpoints.
 */
import { DEFAULT_WORDS, T, type Words } from '../terms/words.js';

export type ToCheckKind = 'credential' | 'right_to_work';
/** How it reached CROP: the person in the app, an upload link, an online application, or the office itself. */
export type ToCheckVia = 'app' | 'link' | 'apply' | 'office';

export interface ToCheckFile { id: string; filename: string; contentType: string }

export interface ToCheckRow {
  kind: ToCheckKind;
  /** The credential's id, or the right to work record's id. */
  id: string;
  workerId: string;
  workerName: string;
  workerStatus: string;
  /** The credential type's name; null for right to work. */
  typeName: string | null;
  category: string | null;
  number: string | null;
  issuedBy: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  /** Right to work: the status the office recorded (citizen, visa_holder, …). */
  status: string | null;
  vevoCheckedOn: string | null;
  via: string | null;
  sentAt: string;
  files: ToCheckFile[];
}

export interface ToCheckItem extends ToCheckRow {
  via: ToCheckVia;
  title: string;
  lines: string[];
}

export const RTW_WORDS: Record<string, string> = {
  citizen: 'Australian citizen', nz_citizen: 'New Zealand citizen', permanent_resident: 'Permanent resident', visa_holder: 'Visa holder',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2 Nov 2026" from YYYY-MM-DD. */
export function dayWords(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
}

export function viaOf(v: string | null | undefined): ToCheckVia {
  return v === 'app' || v === 'link' || v === 'apply' ? v : 'office';
}

const VIA_WORDS: Record<ToCheckVia, string> = {
  app: 'Sent in the app', link: 'Sent by upload link', apply: 'Sent with their application', office: 'Added by the office',
};

/** The lines under the title: who it's for and how it came, the details recorded, and the files. */
export function toCheckLines(r: ToCheckRow): string[] {
  const out: string[] = [];
  const stage = r.workerStatus === 'applicant' ? ' (applying)' : r.workerStatus === 'onboarding' ? ' (getting started)' : '';
  out.push(`${r.workerName}${stage} · ${VIA_WORDS[viaOf(r.via)]}`);
  if (r.kind === 'credential') {
    const facts: string[] = [];
    if (r.number) facts.push(`Number ${r.number}`);
    if (r.issuedBy) facts.push(`Issued by ${r.issuedBy}`);
    if (facts.length) out.push(facts.join(' · '));
    const dates: string[] = [];
    if (r.issueDate) dates.push(`Issued ${dayWords(r.issueDate)}`);
    if (r.expiryDate) dates.push(`Expires ${dayWords(r.expiryDate)}`);
    if (dates.length) out.push(dates.join(' · '));
  } else {
    out.push(r.status ? RTW_WORDS[r.status] ?? r.status : 'Status not recorded');
    if (r.status && r.status !== 'citizen') {
      out.push(r.vevoCheckedOn ? `VEVO checked ${dayWords(r.vevoCheckedOn)}` : 'VEVO check not recorded yet');
    }
  }
  out.push(r.files.length === 0 ? 'No files yet' : r.files.length === 1 ? '1 file' : `${r.files.length} files`);
  return out;
}

export function toCheckItem(r: ToCheckRow, w: Words = DEFAULT_WORDS): ToCheckItem {
  return { ...r, via: viaOf(r.via), title: r.kind === 'credential' ? r.typeName ?? w.one(T.credential) : 'Right to work', lines: toCheckLines(r) };
}

/** Oldest first: whatever has waited longest gets checked first. */
export function sortToCheck<T extends Pick<ToCheckRow, 'sentAt' | 'workerName'>>(list: T[]): T[] {
  return [...list].sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.workerName.localeCompare(b.workerName));
}

/** What was sent, for an alert: never a number; a vaccination is only "a vaccination record". */
export function checkWhat(p: { kind: ToCheckKind; typeName?: string | null; category?: string | null }): string {
  if (p.kind === 'right_to_work') return 'proof of their right to work';
  return p.category === 'vaccination' ? 'a vaccination record' : p.typeName ?? 'a credential';
}

/** The office's phone alert when someone sends something to check (never a number or health detail). */
export function toCheckPush(p: { name: string; what: string; via: 'app' | 'link' }) {
  const how = p.via === 'app' ? 'in the app' : 'by upload link';
  return { title: `To check: ${p.name}`, body: `${p.name} sent ${p.what} ${how}. Open CROP to check it.` };
}
