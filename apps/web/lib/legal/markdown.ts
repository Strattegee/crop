/**
 * A small, safe reader for the legal documents' markdown (headings, paragraphs, bullet lists, tables).
 * It returns plain data; the page turns it into elements, so no HTML from the text is ever injected.
 */
export type Inline = { text: string; placeholder?: boolean };
export type Block =
  | { kind: 'h2' | 'h3'; id: string; text: string }
  | { kind: 'p'; parts: Inline[] }
  | { kind: 'ul'; items: Inline[][] }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] };

/** Removes markdown escapes (\[ \] \| and the like). */
export const unescape = (s: string) => s.replace(/\\([\\[\]|*_#.-])/g, '$1');

/** Splits text so bracketed gaps still to be filled ("[ABN]", "[CONFIRM]") can be highlighted. */
export function inline(raw: string): Inline[] {
  const text = unescape(raw);
  const out: Inline[] = [];
  const re = /\[[^\]]+\]/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], placeholder: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export const slugify = (s: string) =>
  unescape(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => inline(c.trim()));

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  const used = new Map<string, number>();
  const id = (text: string) => {
    const base = slugify(text) || 'section';
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return n ? `${base}-${n + 1}` : base;
  };
  for (const chunk of md.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const lines = chunk.split('\n').filter(l => l.trim() !== '');
    if (!lines.length) continue;
    const first = lines[0];
    if (first.startsWith('## ')) {
      const text = unescape(first.slice(3).trim());
      blocks.push({ kind: 'h3', id: id(text), text });
    } else if (first.startsWith('# ')) {
      const text = unescape(first.slice(2).trim());
      blocks.push({ kind: 'h2', id: id(text), text });
    } else if (first.startsWith('|')) {
      const rows = lines.filter(l => !/^\|?\s*:?-{2,}/.test(l.trim()));
      blocks.push({ kind: 'table', head: cells(rows[0]), rows: rows.slice(1).map(cells) });
    } else if (first.startsWith('- ')) {
      const items: string[] = [];
      for (const l of lines) {
        if (l.startsWith('- ')) items.push(l.slice(2));
        else if (items.length) items[items.length - 1] += ` ${l.trim()}`;
      }
      blocks.push({ kind: 'ul', items: items.map(inline) });
    } else {
      blocks.push({ kind: 'p', parts: inline(lines.map(l => l.trim()).join(' ')) });
    }
  }
  return blocks;
}
