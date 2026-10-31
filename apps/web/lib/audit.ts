/** The audit log screen's wording (pure, tested in test/audit.test.ts). */

/** A stored value as people read it: dates and times as dates, lists joined, nothing as a dash. */
export function auditValue(v: unknown, when: (iso: string) => string): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.length ? v.map(x => auditValue(x, when)).join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return when(s);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return 'a record';
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

/** "Alice Allocator" / "Someone using a link" / "CROP", with how when it wasn't the office. */
export function auditWho(by: string | null, via: string): string {
  const who = by ?? 'Someone';
  return via === 'app' ? `${who} (in the app)` : via === 'link' && by ? `${who} (by link)` : who;
}
