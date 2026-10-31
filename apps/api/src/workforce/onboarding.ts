/**
 * Onboarding checklists (backlog item 11). Pure rules: no database access.
 *
 * A step is one of:
 * - task: the office ticks it (contract signed, induction done); the latest tick decides.
 * - credential: done when the person holds a verified credential of that type that hasn't run out.
 * - right_to_work: done when their right to work is recorded and checked (the same rule rostering uses).
 * - employment: done when they have employment terms that are current or start later.
 *
 * A step that isn't required still shows, but finishing onboarding doesn't wait for it.
 * Wording never includes document numbers or health details (vaccinations are just their credential's name).
 */
import { credentialStatus, rightToWorkIssue, type CredentialFacts, type RightToWorkFacts } from './compliance.js';

export type StepKind = 'task' | 'credential' | 'right_to_work' | 'employment';
export const STEP_KINDS: readonly StepKind[] = ['task', 'credential', 'right_to_work', 'employment'];

export interface Step {
  id: string;
  title: string;
  help: string | null;
  kind: StepKind;
  credentialTypeId: string | null;
  required: boolean;
}

export interface Tick { done: boolean; at: string; byName: string | null; note: string | null }

export interface OnboardingFacts {
  /** Latest tick per task step. */
  ticks: Map<string, Tick>;
  credentials: CredentialFacts[];
  rightToWork: RightToWorkFacts | null;
  /** Live employment terms that are current or start later. */
  hasEmployment: boolean;
  today: string;
  windowDays: number;
}

export type StepState = 'done' | 'waiting' | 'to_do';

export interface StepProgress {
  state: StepState;
  /** Plain words for the office, e.g. "Recorded, waiting to be checked". */
  detail: string;
}

const RTW_DETAIL: Record<string, string> = {
  missing: 'Not recorded yet',
  rejected: 'Rejected: record it again',
  no_work_rights: 'VEVO check needed confirming work rights',
  expired: 'Visa has expired',
  unverified: 'Recorded, waiting to be checked',
};

export function stepProgress(step: Step, f: OnboardingFacts): StepProgress {
  switch (step.kind) {
    case 'task': {
      const t = f.ticks.get(step.id);
      return t?.done ? { state: 'done', detail: t.byName ? `Ticked by ${t.byName}` : 'Ticked' } : { state: 'to_do', detail: 'Not done yet' };
    }
    case 'credential': {
      const ofType = f.credentials.filter(c => c.credentialTypeId === step.credentialTypeId);
      const current = ofType.filter(c => c.verification !== 'rejected' && credentialStatus(c.expiryDate, f.today, f.windowDays) !== 'expired');
      if (current.some(c => c.verification === 'verified')) return { state: 'done', detail: 'Checked and current' };
      if (current.length) return { state: 'waiting', detail: 'Recorded, waiting to be checked' };
      if (ofType.some(c => c.verification !== 'rejected')) return { state: 'to_do', detail: 'Has run out: record the new one' };
      if (ofType.length) return { state: 'to_do', detail: 'Rejected: record it again' };
      return { state: 'to_do', detail: 'Not recorded yet' };
    }
    case 'right_to_work': {
      const issue = rightToWorkIssue(f.rightToWork, f.today, f.windowDays);
      if (!issue || issue.problem === 'expiring') return { state: 'done', detail: 'Recorded and checked' };
      if (issue.problem === 'unverified') return { state: 'waiting', detail: RTW_DETAIL.unverified };
      return { state: 'to_do', detail: RTW_DETAIL[issue.problem] ?? 'Not recorded yet' };
    }
    case 'employment':
      return f.hasEmployment ? { state: 'done', detail: 'Terms set' } : { state: 'to_do', detail: 'No employment terms yet' };
  }
}

export interface ProgressSummary {
  /** Required steps done, and how many are required. */
  done: number;
  total: number;
  /** Every required step is done, so onboarding can be finished. */
  ready: boolean;
  /** Titles of required steps still to do or waiting, in checklist order. */
  outstanding: string[];
}

export function summarise(steps: Step[], progress: StepProgress[]): ProgressSummary {
  const required = steps.map((s, i) => ({ s, p: progress[i] })).filter(x => x.s.required);
  const left = required.filter(x => x.p.state !== 'done');
  return { done: required.length - left.length, total: required.length, ready: left.length === 0, outstanding: left.map(x => x.s.title) };
}

/** Why onboarding can't be finished yet, in one sentence. */
export function notReadyMessage(s: ProgressSummary): string {
  const list = s.outstanding.length <= 3 ? s.outstanding.join(', ') : `${s.outstanding.slice(0, 3).join(', ')} and ${s.outstanding.length - 3} more`;
  return `Onboarding isn't finished: still to do ${list}`;
}

export interface StepInput {
  id?: string;
  title: string;
  help: string | null;
  kind: StepKind;
  credentialTypeId: string | null;
  required: boolean;
}

/** The default title for a step that checks a record. */
export function defaultTitle(kind: StepKind, typeName?: string): string {
  if (kind === 'right_to_work') return 'Right to work recorded and checked';
  if (kind === 'employment') return 'Employment terms set';
  if (kind === 'credential') return typeName ?? 'Credential';
  return 'Task';
}

/**
 * A starting checklist from the business's own rules: right to work, employment terms, then every credential that
 * must be held (by everyone, or by one of the given roles), then those that should be held (not required).
 * Optional requirements are left out.
 */
export function stepsFromRequirements(
  rules: { credentialTypeId: string; typeName: string; scope: 'all_workers' | 'role'; role: string | null; severity: 'hard' | 'warning' | 'optional' }[],
  roles: string[],
): StepInput[] {
  // Optional requirements are listed, never checked, so they don't become steps.
  const applies = rules.filter(r => r.severity !== 'optional' && (r.scope === 'all_workers' || (r.role !== null && roles.includes(r.role))));
  const byType = new Map<string, { typeName: string; hard: boolean }>();
  for (const r of applies) {
    const prev = byType.get(r.credentialTypeId);
    byType.set(r.credentialTypeId, { typeName: r.typeName, hard: (prev?.hard ?? false) || r.severity === 'hard' });
  }
  const creds = [...byType.entries()].sort((a, b) => (a[1].hard === b[1].hard ? a[1].typeName.localeCompare(b[1].typeName) : a[1].hard ? -1 : 1));
  return [
    { title: defaultTitle('right_to_work'), help: null, kind: 'right_to_work', credentialTypeId: null, required: true },
    { title: defaultTitle('employment'), help: null, kind: 'employment', credentialTypeId: null, required: true },
    ...creds.map(([id, c]): StepInput => ({ title: c.typeName, help: null, kind: 'credential', credentialTypeId: id, required: c.hard })),
  ];
}

/** What a step asks of the person themselves, for the "ask for what's still needed" message. */
export interface AskableStep extends Step { category?: string | null; typeName?: string | null }

/**
 * The things the person can supply that are still outstanding: credentials not yet recorded (or run out or
 * rejected) and right to work not yet recorded. Steps already recorded and waiting for the office to check them,
 * tasks the office ticks and employment terms are not the person's to supply, so they aren't asked for.
 * Vaccinations are only ever "a vaccination record" (no health details in messages).
 */
export function askableItems(steps: AskableStep[], progress: StepProgress[]): { label: string; required: boolean }[] {
  const out: { label: string; required: boolean }[] = [];
  const seen = new Set<string>();
  steps.forEach((s, i) => {
    if (progress[i]?.state !== 'to_do') return;
    let label: string | null = null;
    if (s.kind === 'credential') label = s.category === 'vaccination' ? 'a vaccination record' : (s.typeName ?? s.title);
    if (s.kind === 'right_to_work') label = 'proof of your right to work (for example your passport, citizenship certificate or visa details)';
    if (!label || seen.has(label)) return;
    seen.add(label);
    out.push({ label, required: s.required });
  });
  return out;
}

/** The email (and short text) asking a new person for what's still needed. Plain words; no numbers or health details. */
export function askMessage(o: {
  first: string; business: string; items: { label: string; required: boolean }[]; note: string | null; emailed?: boolean;
  /** The upload link's lines (upload-links.ts), when one was made: the person sends things through it. */
  linkLines?: { email: string; sms: string };
}) {
  const needed = o.items.filter(x => x.required);
  const optional = o.items.filter(x => !x.required);
  const subject = `${o.business}: what we still need from you before you start`;
  const lines = [`Hi ${o.first},`, ''];
  if (needed.length) {
    lines.push(`Before you can start work with ${o.business}, we still need:`, ...needed.map(x => `- ${x.label}`));
  }
  if (optional.length) {
    if (needed.length) lines.push('');
    lines.push(needed.length ? 'It would also help to have:' : `${o.business} would also like to have:`, ...optional.map(x => `- ${x.label}`));
  }
  if (o.note) lines.push('', o.note);
  if (o.linkLines) lines.push('', o.linkLines.email, '', `If you have already sent something, thank you: we will check it soon.`);
  else lines.push('', `Please send a clear photo or scan of each to ${o.business}, or bring them in. If you have already sent something, thank you: we will check it soon.`);
  const shortList = o.items.length <= 2 ? o.items.map(x => x.label.replace(/ \(for example.*\)$/, '')).join(' and ') : `${o.items.length} things`;
  const sms = `${o.business}: before you start we still need ${shortList} from you. ${o.linkLines ? o.linkLines.sms : o.emailed === false ? `Please send a photo or bring them in.` : 'Details are in your email.'}`;
  return { subject, email: lines.join('\n'), sms };
}

/** Sent instead of a checklist id: pick the checklist that fits the person's roles. */
export const CHECKLIST_BY_ROLE = 'auto';

/**
 * The checklist that fits a person's roles: the one written for the most of their roles (roles match exactly, like
 * credential rules), else one for anyone (no roles), alphabetically on ties. Null when none fits, e.g. every
 * checklist is for other roles. Put-away checklists should be left out by the caller.
 */
export function checklistForRoles<C extends { id: string; name: string; forRoles: string[] }>(checklists: C[], roles: string[]): C | null {
  const mine = new Set(roles);
  const byName = (a: C, b: C) => a.name.localeCompare(b.name);
  const scored = checklists
    .filter(c => c.forRoles.length)
    .map(c => ({ c, n: c.forRoles.filter(r => mine.has(r)).length }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n || byName(a.c, b.c));
  if (scored.length) return scored[0].c;
  return checklists.filter(c => !c.forRoles.length).sort(byName)[0] ?? null;
}
