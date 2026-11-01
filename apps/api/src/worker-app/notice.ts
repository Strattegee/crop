/**
 * The worker privacy notice in the app (pure; tested in test/worker-app.spec.ts). The notice itself is one of the
 * legal documents (docs/legal/worker-notice.md, shown on the web at /legal/worker-notice); the app shows it the first
 * time someone opens it for a business and again whenever its version changes.
 *
 * Keep NOTICE_VERSION the same as VERSION in docs/legal/build.py (a test checks the web's LEGAL_VERSION carries it).
 */
export const NOTICE_VERSION = '0.1 (draft), 24 October 2026';
export const NOTICE_PATH = '/legal/worker-notice';

export type NoticeState = 'new' | 'changed' | 'seen';

/** `latest` is the version the person last confirmed here (null = never). */
export function noticeState(latest: string | null, current = NOTICE_VERSION): NoticeState {
  if (!latest) return 'new';
  return latest === current ? 'seen' : 'changed';
}

/** Where the app opens the notice: the web's public legal page, when APP_URL is set. */
export function noticeUrl(appUrl: string | undefined): string | null {
  return appUrl ? `${appUrl.replace(/\/+$/, '')}${NOTICE_PATH}` : null;
}

/** Refuses a confirmation of anything but the notice the app is showing now. */
export function noticeRefusal(version: unknown, current = NOTICE_VERSION): string | null {
  if (typeof version !== 'string' || !version) return 'Say which version of the notice you read';
  if (version !== current) return 'The notice has changed since this screen opened. Please read the latest version.';
  return null;
}
