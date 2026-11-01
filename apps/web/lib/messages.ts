/** Wording for the Messages page (tested in test/messages.test.ts). */

/** What each kind of message is called on the Messages page. */
export const TEMPLATE_NAMES: Record<string, string> = {
  test: 'Test', welcome: 'Welcome',
  credential_expiry: 'Expiry reminder', compliance_expiry: 'Office expiry alert', daily_dashboard: 'Daily email',
  shift_offer: 'Shift offer', shift_booked: 'Shift booked', shift_filled: 'Shift filled', roster_published: 'Roster published',
  change_request: 'Change request', change_request_decided: 'Change request decided',
  onboarding_request: 'Onboarding request', upload_link: 'Upload link', link_credential_added: 'Sent by upload link',
  app_leave_request: 'Leave asked for in the app', app_credential_added: 'Added in the app', app_right_to_work_added: 'Right to work proof from the app',
  agency_request: 'Agency request', agency_offer: 'Agency offer', agency_offer_accepted: 'Agency offer accepted', agency_offer_filled: 'Agency offer filled',
  agency_put_forward: 'Agency put someone forward', agency_pulled_out: 'Agency pulled someone out', agency_placement_changed: 'Agency shift changed',
  outside_agency_request: 'Request to an outside agency',
};

export const templateName = (template: string) => TEMPLATE_NAMES[template] ?? template.replace(/_/g, ' ');

/** "1 part", "3 parts", plus why a text cost more when it had to go as Unicode. */
export function smsPartsLine(parts: number, unicode: string[] = []): string {
  const base = parts === 1 ? '1 part' : `${parts} parts`;
  if (unicode.length === 0) return base;
  const shown = unicode.slice(0, 3).map(c => `“${c}”`).join(', ');
  return `${base}, sent as Unicode because of ${shown}${unicode.length > 3 ? ' and others' : ''}`;
}

/** "Texts this month: 12 of 2000 (19 parts)". Parts are what the SMS provider bills. */
export function textsThisMonth(used: number, cap: number, parts: number | undefined): string {
  return parts === undefined || parts === used ? `${used} of ${cap}` : `${used} of ${cap} (${parts} parts)`;
}
