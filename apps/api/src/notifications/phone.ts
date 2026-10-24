/** Normalises an Australian mobile number to +614XXXXXXXX, or returns null if it isn't one. */
export function auMobile(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/[\s()-]/g, '');
  const m = digits.match(/^(?:\+?61|0)(4\d{8})$/);
  return m ? `+61${m[1]}` : null;
}
