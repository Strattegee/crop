import { describe, expect, it } from 'vitest';
import { LEGAL_DOCS } from '../lib/legal/documents';
import { inline, parseMarkdown } from '../lib/legal/markdown';

describe('legal markdown', () => {
  it('reads headings, paragraphs, lists and tables, and marks gaps still to fill', () => {
    const blocks = parseMarkdown('# 1. Who\n\n## About\n\nWe are \\[ABN\\] here.\n\n- one\n  more\n- two\n\n| A | B |\n|---|---|\n| x | \\[CONFIRM\\] |');
    expect(blocks.map(b => b.kind)).toEqual(['h2', 'h3', 'p', 'ul', 'table']);
    expect(blocks[0]).toMatchObject({ id: '1-who', text: '1. Who' });
    expect(blocks[2]).toEqual({ kind: 'p', parts: [{ text: 'We are ' }, { text: '[ABN]', placeholder: true }, { text: ' here.' }] });
    expect(blocks[3]).toEqual({ kind: 'ul', items: [[{ text: 'one more' }], [{ text: 'two' }]] });
    expect(blocks[4]).toMatchObject({ kind: 'table', rows: [[[{ text: 'x' }], [{ text: '[CONFIRM]', placeholder: true }]]] });
  });

  it('gives repeated headings different ids', () => {
    const ids = parseMarkdown('## Notice\n\n## Notice').map(b => ('id' in b ? b.id : ''));
    expect(ids).toEqual(['notice', 'notice-2']);
  });

  it('keeps escapes out of the text', () => {
    expect(inline('Effective \\[DATE\\] \\| Last')).toEqual([{ text: 'Effective ' }, { text: '[DATE]', placeholder: true }, { text: ' | Last' }]);
  });

  it('has every document, each with content and no drafting instructions left in', () => {
    expect(LEGAL_DOCS.map(d => d.slug)).toEqual(['privacy', 'worker-notice', 'terms', 'data-processing', 'acceptable-use', 'schedules']);
    for (const d of LEGAL_DOCS) {
      expect(parseMarkdown(d.body).length).toBeGreaterThan(3);
      expect(d.body).not.toMatch(/must be updated to match actual data flows|Display this short notice/);
    }
  });
});
