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
  const base = (name ?? 'document').split(/[\\/]/).pop() ?? 'document';
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  return cleaned || 'document';
}
