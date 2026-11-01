/**
 * Texts that cost less (backlog item 6, "short link for SMS"). Pure functions: no database access.
 *
 * A text is billed per part. Written only in the GSM 7-bit alphabet, a part holds 160 characters (153 each when
 * a text needs several). One character outside that alphabet, such as the en dash in "07:00–15:30" or a curly
 * apostrophe, makes the whole text Unicode, where a part holds only 70 (67 each). So every text is tidied before
 * it is queued: punctuation that has a plain equivalent is swapped for it. Letters are never changed (a person's
 * or business's name is kept exactly as written, even when that means Unicode).
 */

/** The GSM 03.38 basic alphabet (one septet each). */
const GSM_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);
/** The extension table: each costs two septets. */
const GSM_EXTENDED = new Set('^{}\\[~]|€\f');

/** Punctuation with a plain equivalent in the GSM alphabet. */
const PLAIN: Record<string, string> = {
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-',
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'", '´': "'", '`': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"', '«': '"', '»': '"',
  '…': '...', '·': '-', '•': '-', '→': '->',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '\t': ' ',
  '​': '', '‌': '', '‍': '', '﻿': '',
};

/** The text as it will be sent: plain punctuation, no doubled spaces, trimmed. */
export function smsText(body: string): string {
  let out = '';
  for (const ch of body) out += PLAIN[ch] ?? ch;
  return out.replace(/ {2,}/g, ' ').trim();
}

export interface SmsSize { encoding: 'gsm' | 'unicode'; length: number; parts: number }

/** How the text will be sent and how many parts it is billed as. */
export function smsSize(text: string): SmsSize {
  let septets = 0;
  let gsm = true;
  for (const ch of text) {
    if (GSM_BASIC.has(ch)) septets += 1;
    else if (GSM_EXTENDED.has(ch)) septets += 2;
    else { gsm = false; break; }
  }
  if (gsm) return { encoding: 'gsm', length: septets, parts: septets <= 160 ? 1 : Math.ceil(septets / 153) };
  const units = text.length; // UTF-16 code units, as sent in UCS-2
  return { encoding: 'unicode', length: units, parts: units <= 70 ? 1 : Math.ceil(units / 67) };
}

/** Characters that still make a tidied text Unicode (for the Messages page), e.g. ["ā"]. */
export function unicodeCharacters(text: string): string[] {
  const found = new Set<string>();
  for (const ch of text) if (!GSM_BASIC.has(ch) && !GSM_EXTENDED.has(ch)) found.add(ch);
  return [...found];
}
