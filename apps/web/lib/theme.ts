/**
 * Light or dark (David, 2 Nov): each person chooses in their menu; the choice lives in a cookie on that browser.
 * "Match my device" follows the computer's own setting (worked out in the browser before the page paints).
 */
export const THEME_COOKIE = 'crop_theme';
export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = typeof THEMES[number];
export const THEME_LABEL: Record<Theme, string> = { light: 'Light', dark: 'Dark', system: 'Match my device' };

/** The saved choice, or light when there is none (CROP's look until someone chooses otherwise). */
export function parseTheme(value: string | undefined | null): Theme {
  return (THEMES as readonly string[]).includes(value ?? '') ? (value as Theme) : 'light';
}

/** What the server can render before the browser has spoken: dark only when chosen outright. */
export function serverMode(theme: Theme): 'light' | 'dark' {
  return theme === 'dark' ? 'dark' : 'light';
}

/** A fixed script (no data from anyone goes into it). Runs in <head> before paint: for "Match my device", reads the computer's setting and sets data-mode. */
export const SYSTEM_MODE_SCRIPT =
  "(function(){try{var d=document.documentElement;if(d.dataset.theme==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches){d.dataset.mode='dark';}}catch(e){}})();";
