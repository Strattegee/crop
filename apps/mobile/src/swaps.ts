/**
 * Shift swaps in the worker app (API: /my/swaps, migration 0073). Pure helpers, tested in test/swaps.spec.ts.
 */
import { dayLabel } from './format';

export type SwapMode = 'off' | 'approve' | 'automatic';
export type SwapStatus = 'asked' | 'agreed' | 'done' | 'declined' | 'refused' | 'withdrawn' | 'closed';

export interface SwapShift { id: string; localDate: string; localStart: string; localEnd: string; role: string; site: string; area: string | null }

export interface MySwap {
  id: string; status: SwapStatus; mine: boolean; colleague: string;
  shift: SwapShift; other: SwapShift | null;
  line: string; stateLine: string; canAnswer: boolean; canWithdraw: boolean;
}

export interface SwapOptions {
  mode: SwapMode;
  takers: { workerId: string; name: string }[];
  swaps: { shiftId: string; workerId: string; name: string; shift: Omit<SwapShift, 'id'> }[];
}

/** "Mon 9 Nov 07:00–15:00" (Today/Tomorrow when `today` is given). */
export const whenLine = (s: { localDate: string; localStart: string; localEnd: string }, today?: string) =>
  `${dayLabel(s.localDate, today)} ${s.localStart}–${s.localEnd}`;

/** The swap from the person's side, in a line: what they'd give and get. */
export function mySwapLine(s: MySwap, today?: string): string {
  const mineGive = s.mine ? s.shift : s.other;
  const mineGet = s.mine ? s.other : s.shift;
  if (!s.other) {
    return s.mine
      ? `You asked ${s.colleague} to take ${whenLine(s.shift, today)}`
      : `${s.colleague} asks you to take ${whenLine(s.shift, today)}`;
  }
  return `${s.mine ? `Swap with ${s.colleague}` : `${s.colleague} asks to swap`}: you give ${whenLine(mineGive!, today)}, you get ${whenLine(mineGet!, today)}`;
}

/** Asks waiting for the person first, then their own open asks, then recent closed ones. */
export function swapOrder(list: MySwap[]): MySwap[] {
  const rank = (s: MySwap) => (s.canAnswer ? 0 : s.canWithdraw ? 1 : 2);
  return [...list].sort((a, b) => rank(a) - rank(b));
}

/** Whether a shift of theirs can be offered for a swap now: swaps on, and no open ask about it already. */
export function canSwap(shiftId: string, mode: SwapMode | undefined, list: MySwap[]): boolean {
  if (!mode || mode === 'off') return false;
  return !list.some(s => s.mine && s.shift.id === shiftId && (s.status === 'asked' || s.status === 'agreed'));
}

/** The note under the picker: what happens after the colleague says yes. */
export function afterYesLine(mode: SwapMode): string {
  return mode === 'automatic' ? 'If they say yes, the swap is made straight away.' : 'If they say yes, the office approves it before anything changes.';
}

/** What the person sees after asking. */
export const askedMessage = (name: string, mode: SwapMode, shiftWord = 'shift') =>
  `We've asked ${name}. You stay on your ${shiftWord} until they say yes${mode === 'approve' ? ' and the office approves' : ''}.`;

export const SWAP_BADGE: Record<SwapStatus, 'booked' | 'waiting' | 'urgent'> = {
  asked: 'waiting', agreed: 'waiting', done: 'booked', declined: 'urgent', refused: 'urgent', withdrawn: 'urgent', closed: 'urgent',
};
