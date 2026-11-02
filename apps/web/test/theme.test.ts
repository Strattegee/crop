import { describe, expect, it } from 'vitest';
import { parseTheme, serverMode, THEME_LABEL } from '../lib/theme';

describe('light and dark', () => {
  it('reads the saved choice, light when there is none', () => {
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('system')).toBe('system');
    expect(parseTheme(undefined)).toBe('light');
    expect(parseTheme('purple')).toBe('light');
  });
  it('renders dark on the server only when chosen outright', () => {
    expect(serverMode('dark')).toBe('dark');
    expect(serverMode('system')).toBe('light');
    expect(THEME_LABEL.system).toBe('Match my device');
  });
});
