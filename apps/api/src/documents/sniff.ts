/**
 * Works out the file type from its first bytes, not from the name or what the browser claims,
 * so a renamed file (e.g. a web page called cert.pdf) is refused.
 */
export function sniffType(buf: Buffer): 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/heic' | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp' && ['heic', 'heix', 'mif1', 'heim', 'heis'].includes(buf.subarray(8, 12).toString('latin1'))) {
    return 'image/heic';
  }
  return null;
}

/** Keeps just the file name, without paths or control characters. */
export function cleanFilename(name: string | undefined): string {
  const base = utf8Name((name ?? 'document').split(/[\\/]/).pop() ?? 'document');
  // Mac screenshots put a narrow no-break space before "pm"; show it as an ordinary space.
  const cleaned = base.replace(/[\u00a0\u202f]/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  return cleaned || 'document';
}

/**
 * Multipart file names arrive read as Latin-1 (the upload library's default), so a UTF-8 name such as
 * "Screenshot … 4.19.40\u202fpm.png" shows as "4.19.40â€¯pm.png". Read the bytes again as UTF-8 when that gives a
 * clean result; a name that really was Latin-1 doesn't decode cleanly and is kept as it came.
 */
export function utf8Name(name: string): string {
  if (!/[\u0080-\u00ff]/.test(name) || /[^\u0000-\u00ff]/.test(name)) return name;
  const again = Buffer.from(name, 'latin1').toString('utf8');
  return again.includes('\ufffd') ? name : again;
}
