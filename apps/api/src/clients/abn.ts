/** Australian Business Number check (11 digits with the ATO checksum). Accepts spaces. */
export function normaliseAbn(input: string): string | null {
  const digits = input.replace(/\s+/g, '');
  if (!/^\d{11}$/.test(digits)) return null;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const sum = digits.split('').reduce((acc, d, i) => acc + (Number(d) - (i === 0 ? 1 : 0)) * weights[i], 0);
  return sum % 89 === 0 ? digits : null;
}

export const STATE_TIMEZONES: Record<string, string> = {
  VIC: 'Australia/Melbourne', NSW: 'Australia/Sydney', ACT: 'Australia/Sydney', QLD: 'Australia/Brisbane',
  SA: 'Australia/Adelaide', WA: 'Australia/Perth', TAS: 'Australia/Hobart', NT: 'Australia/Darwin',
};
