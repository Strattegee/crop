/**
 * Push notifications to the CROP app (pure rules). The app sends its Expo push token after sign-in; messages are
 * queued once per phone (channel 'push') and sent through Expo's push service when PUSH_SEND=on.
 * Push text is short and, like texts, never carries health information or document numbers.
 */

/** Expo push tokens: ExponentPushToken[...] (older) or ExpoPushToken[...]. */
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_\-]{10,200}\]$/;

export const PUSH_PLATFORMS = ['ios', 'android'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

export function pushTokenProblem(token: string): string | null {
  return EXPO_TOKEN.test(token) ? null : 'This phone sent a push token CROP does not recognise';
}

/** Lock screens show about this much; longer text is cut with an ellipsis. */
export const PUSH_TITLE_MAX = 65;
export const PUSH_BODY_MAX = 178;

function cut(s: string, max: number) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** A push message's title and body, tidied to one line each and cut to what a lock screen shows. */
export function pushText(title: string, body: string) {
  return { title: cut(title, PUSH_TITLE_MAX), body: cut(body, PUSH_BODY_MAX) };
}

/** Why a queued push is logged as skipped rather than sent. */
export const PUSH_OFF = 'Push notifications are not switched on yet';

/**
 * Screens of the app a tapped notification can open: the worker side's tabs, and (office alerts, 6 Nov) the manager
 * side's Needs attention (`attention`) and Requests (`requests`) tabs.
 */
export const PUSH_SCREENS = ['shifts', 'offers', 'availability', 'credentials', 'details', 'attention', 'requests'] as const;
export type PushScreen = (typeof PUSH_SCREENS)[number];

/** Which screen a message's template opens; null = the app opens as usual. */
const SCREEN_FOR: Record<string, PushScreen> = {
  shift_offer: 'offers',
  shift_booked: 'shifts',
  roster_published: 'shifts',
  shift_swap_asked: 'shifts',
  shift_swap_declined: 'shifts',
  shift_swap_done: 'shifts',
  shift_swap_refused: 'shifts',
  credential_expiry: 'credentials',
  day_request_answered: 'availability',
  detail_change_decided: 'details',
  office_shift_at_risk: 'attention',
  office_pulled_out: 'attention',
  office_leave_to_approve: 'requests',
  office_change_to_approve: 'requests',
};

export function pushScreen(template: string): PushScreen | null {
  return SCREEN_FOR[template] ?? null;
}
