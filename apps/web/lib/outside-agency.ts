/**
 * Agencies not on CROP (migration 0060; David's answer 4, option 1): the words for a person an outside agency named
 * and the office put on a shift. CROP holds only their name, so it never checked their credentials or right to work.
 */
export const UNCHECKED = 'unchecked';

/** The line under the person on the shift panel. */
export function uncheckedNote(agencyName: string): string {
  return `Named by ${agencyName}, which isn't on CROP. CROP hasn't checked their credentials or right to work: ${agencyName} is responsible for that.`;
}

/** The message after putting them on. */
export function addedMessage(firstName: string, lastName: string, shiftWord: string): string {
  return `${firstName} ${lastName} is booked on the ${shiftWord}, marked as ${UNCHECKED}.`;
}
