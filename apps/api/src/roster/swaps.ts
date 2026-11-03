/**
 * Shift swaps between workers in the app (migration 0073): pure rules and wording, tested in test/swaps.spec.ts.
 * The database steps live in swaps-data.ts; the endpoints in worker-app/my-swaps.controller.ts (workers) and
 * swaps.controller.ts (the office).
 */
import { fmtDate } from './eligibility.js';
import { DEFAULT_WORDS, T, type Words } from '../terms/words.js';

export const SWAP_MODES = ['off', 'approve', 'automatic'] as const;
export type SwapMode = typeof SWAP_MODES[number];
export type SwapStatus = 'asked' | 'agreed' | 'done' | 'declined' | 'refused' | 'withdrawn' | 'closed';

export function swapModeLabel(m: SwapMode, w: Words = DEFAULT_WORDS): string {
  if (m === 'off') return `Off: ${w.lower(T.worker, true)} can't swap ${w.lower(T.shift, true)} in the app`;
  if (m === 'approve') return 'On: the colleague agrees, then an owner or admin approves';
  return 'On: the swap happens as soon as the colleague agrees';
}

/** One shift as a swap shows it. */
export interface SwapShift { localDate: string; localStart: string; localEnd: string; role: string; site: string; area: string | null }

export const swapShiftLine = (s: SwapShift) =>
  `${fmtDate(s.localDate)}, ${s.localStart}–${s.localEnd}, ${s.role} at ${s.site}${s.area ? ` (${s.area})` : ''}`;

/** What the asker's shift needs to be before they can ask: on it, not started, not cancelled. */
export interface AskFacts {
  mode: SwapMode;
  onShift: boolean;
  started: boolean;
  cancelled: boolean;
  /** Published week (the app only shows published weeks, so swaps are only for those). */
  published: boolean;
  openSwap: boolean;
  colleagueActive: boolean;
  /** For a swap: the colleague is on the other shift, it hasn't started and isn't cancelled. */
  other?: { colleagueOnIt: boolean; started: boolean; cancelled: boolean; published: boolean; sameShift: boolean } | null;
}

/** Why the person can't ask for this swap, or null. Plain words for the app. */
export function askRefusal(f: AskFacts, w: Words = DEFAULT_WORDS): string | null {
  const shift = w.lower(T.shift);
  if (f.mode === 'off') return `Swapping ${w.lower(T.shift, true)} isn't turned on here. Contact the office.`;
  if (!f.onShift) return `You aren't on this ${shift}`;
  if (f.cancelled) return `This ${shift} is cancelled`;
  if (f.started) return `This ${shift} has already started`;
  if (!f.published) return `This ${shift} isn't on a published ${w.lower(T.roster)} yet`;
  if (f.openSwap) return `You've already asked about this ${shift}. Take that back first.`;
  if (!f.colleagueActive) return 'Choose someone to swap with';
  if (f.other) {
    if (f.other.sameShift) return `Choose a different ${shift} to swap for`;
    if (!f.other.colleagueOnIt) return `They aren't on that ${shift}`;
    if (f.other.cancelled) return `That ${shift} is cancelled`;
    if (f.other.started) return `That ${shift} has already started`;
    if (!f.other.published) return `That ${shift} isn't on a published ${w.lower(T.roster)} yet`;
  }
  return null;
}

/** The colleague answering: only while it waits for them. */
export function answerRefusal(status: SwapStatus): string | null {
  if (status === 'asked') return null;
  if (status === 'agreed') return 'You have already said yes. It is waiting for the office.';
  return closedWords(status);
}

/** An owner or admin deciding: only once the colleague has agreed. */
export function decideRefusal(status: SwapStatus): string | null {
  if (status === 'agreed') return null;
  if (status === 'asked') return 'The colleague hasn\'t answered yet';
  return closedWords(status);
}

/** The asker taking it back: while it is still open. */
export function withdrawRefusal(status: SwapStatus): string | null {
  if (status === 'asked' || status === 'agreed') return null;
  return closedWords(status);
}

function closedWords(status: SwapStatus): string {
  return ({
    done: 'This swap has already been made', declined: 'This swap was declined', refused: 'This swap was not approved',
    withdrawn: 'This swap was taken back', closed: 'This swap is closed: one of the shifts changed',
  } as Record<string, string>)[status] ?? 'This swap is closed';
}

export interface SwapView {
  fromName: string; toName: string;
  shift: SwapShift; other: SwapShift | null;
}

/** One line for lists: "Ana Example asks Ben Example to take Mon 9 Nov, 07:00–15:00, …" */
export function swapSummary(s: SwapView): string {
  return s.other
    ? `${s.fromName} and ${s.toName} swap: ${s.fromName} gives ${swapShiftLine(s.shift)}; ${s.toName} gives ${swapShiftLine(s.other)}`
    : `${s.fromName} asks ${s.toName} to take ${swapShiftLine(s.shift)}`;
}

/** What the person sees about a swap in the app, from their side. */
export function swapStateLine(status: SwapStatus, mine: boolean): string {
  switch (status) {
    case 'asked': return mine ? 'Waiting for their answer' : 'Waiting for your answer';
    case 'agreed': return 'Agreed. Waiting for the office to approve';
    case 'done': return 'Swapped';
    case 'declined': return mine ? 'They said no' : 'You said no';
    case 'refused': return 'The office did not approve it';
    case 'withdrawn': return mine ? 'You took it back' : 'They took it back';
    case 'closed': return 'Closed: one of the shifts changed';
  }
}

const end = 'CROP Workforce Management';
const join = (lines: (string | null)[]) => lines.filter((l): l is string => l !== null).join('\n');

/** To the colleague: someone asks them. They answer in the app. */
export function swapAskedEmail(s: SwapView & { toFirstName: string; business: string }, w: Words = DEFAULT_WORDS) {
  const subject = s.other ? `${s.fromName} asks to swap ${w.lower(T.shift, true)} with you` : `${s.fromName} asks you to take a ${w.lower(T.shift)}`;
  return {
    subject,
    body: join([
      `Hi ${s.toFirstName},`,
      ``,
      s.other
        ? `${s.fromName} would like to swap ${w.lower(T.shift, true)} with you at ${s.business}.`
        : `${s.fromName} would like you to take their ${w.lower(T.shift)} at ${s.business}.`,
      `You would work: ${swapShiftLine(s.shift)}`,
      s.other ? `They would work yours: ${swapShiftLine(s.other)}` : null,
      ``,
      `Open the CROP app to say yes or no.`,
      ``,
      end,
    ]),
    push: { title: subject, body: `You would work: ${swapShiftLine(s.shift)}. Open CROP to say yes or no.` },
  };
}

/** To the asker: the colleague said no. */
export function swapDeclinedEmail(s: SwapView & { fromFirstName: string }, w: Words = DEFAULT_WORDS) {
  return {
    push: { title: `${s.toName} can't take your ${w.lower(T.shift)}`, body: `${swapShiftLine(s.shift)}. It's still yours.` },
    subject: `${s.toName} can't take your ${w.lower(T.shift)}`,
    body: join([
      `Hi ${s.fromFirstName},`, ``,
      `${s.toName} said no to ${s.other ? 'swapping' : 'taking'} ${swapShiftLine(s.shift)}.`,
      `You are still on it. You can ask someone else in the CROP app.`, ``, end,
    ]),
  };
}

/** To the office's owners and admins: both people agree, it needs approval. */
export function swapToApproveEmail(s: SwapView, appUrl: string, w: Words = DEFAULT_WORDS) {
  const link = appUrl ? `${appUrl.replace(/\/+$/, '')}/dashboard` : null;
  return {
    subject: `${w.one(T.shift)} swap to approve: ${s.fromName} and ${s.toName}`,
    body: join([
      `${s.fromName} and ${s.toName} have agreed a swap in the CROP app:`,
      swapSummary(s) + '.',
      ``,
      link ? `To approve it or not, open the Dashboard: ${link}` : `To approve it or not, open the Dashboard in CROP.`,
      ``, end,
    ]),
  };
}

/** To each of the two people: the swap is made, or the office didn't approve it. */
export function swapOutcomeEmail(s: SwapView & { firstName: string; isAsker: boolean }, outcome: 'done' | 'refused', w: Words = DEFAULT_WORDS) {
  const mine = s.isAsker ? s.shift : s.other;
  const theirs = s.isAsker ? s.other : s.shift;
  const shiftW = w.lower(T.shift);
  if (outcome === 'done') {
    return {
      subject: `${w.one(T.shift)} swap done`,
      body: join([
        `Hi ${s.firstName},`, ``,
        theirs ? `You are now on ${swapShiftLine(theirs)}.` : null,
        mine ? `You are no longer on ${swapShiftLine(mine)}.` : null,
        ``, end,
      ]),
    };
  }
  return {
    subject: `${w.one(T.shift)} swap not approved`,
    body: join([
      `Hi ${s.firstName},`, ``,
      `The office did not approve the swap of ${swapShiftLine(s.shift)}${s.other ? ` and ${swapShiftLine(s.other)}` : ''}.`,
      `Your ${w.lower(T.shift, true)} stay as they were. Contact the office if you have questions about this ${shiftW}.`,
      ``, end,
    ]),
  };
}
