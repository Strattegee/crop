import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('globals.css', () => {
  it('closes every block, so styles after a media query apply at every width', () => {
    const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0;
    const lines = css.split('\n');
    lines.forEach((line, i) => {
      // A rule starting at the left edge must be at the top level (media query bodies are indented).
      if (/^[.#a-z:[*]/i.test(line) && depth !== 0) throw new Error(`globals.css line ${i + 1} is inside an unclosed block`);
      depth += (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length;
    });
    expect(depth).toBe(0);
  });
});
