/** What the person's Worker app card says about the worker privacy notice (tested in test/worker-notice.test.ts). */
export type NoticeSeen = { version: string; acknowledgedAt: string; current: boolean } | null;

export function noticeLine(first: string, n: NoticeSeen, day: (iso: string) => string): string {
  if (!n) return `${first} is shown the worker privacy notice the first time they open the app.`;
  if (n.current) return `${first} confirmed reading the worker privacy notice on ${day(n.acknowledgedAt)}.`;
  return `${first} confirmed an earlier version of the worker privacy notice on ${day(n.acknowledgedAt)}; the app shows them the new one next time they open it.`;
}
