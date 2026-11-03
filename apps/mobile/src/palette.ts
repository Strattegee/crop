/**
 * The app's colours (Milos's palette, 2 Nov; the web uses the same values in globals.css), light and dark.
 * Pure data and rules, no React Native, so they can be tested: every text colour must be readable on the
 * background it sits on, in both modes (see test/palette.spec.ts).
 */
export type Scheme = 'light' | 'dark';

export interface Palette {
  /** Page background. */
  bg: string;
  /** Cards, inputs and the chosen tab. */
  surface: string;
  /** The tab bar's track. */
  track: string;
  text: string;
  /** Titles, headings and links (navy in light mode). */
  strong: string;
  muted: string;
  border: string;
  /** Input and chip borders. */
  borderStrong: string;
  divider: string;
  /** Main buttons and chosen chips. */
  button: string;
  onButton: string;
  bad: string;
  /** Text on a `bad` button. */
  onBad: string;
  good: string;
  /** Darker amber for "changes since publishing" and warnings in text. */
  warn: string;
  badBg: string;
  bookedBg: string;
  bookedText: string;
  waitingBg: string;
  waitingText: string;
  urgentBg: string;
  urgentText: string;
  urgentBorder: string;
}

export const NAVY = '#0f1e3d';
export const ORANGE = '#f26b1d';

export const LIGHT: Palette = {
  bg: '#f4f6fa',
  surface: '#ffffff',
  track: '#e6e9ee',
  text: NAVY,
  strong: NAVY,
  muted: '#4f5d75',
  border: '#d3dae5',
  borderStrong: '#c5ccd6',
  divider: '#e3e6ee',
  button: NAVY,
  onButton: '#ffffff',
  bad: '#b42318',
  onBad: '#ffffff',
  good: '#1a7f37',
  warn: '#6b5300',
  badBg: '#fdecea',
  bookedBg: '#d3f0dc',
  bookedText: '#11592b',
  waitingBg: '#fbefc4',
  waitingText: '#6b5300',
  urgentBg: '#fde2e0',
  urgentText: '#8a1c12',
  urgentBorder: '#e8a29b',
};

/** Dark mode follows the web's dark values (2 Nov): navy surfaces, light text, orange main buttons with navy text. */
export const DARK: Palette = {
  bg: '#0b1426',
  surface: '#111c33',
  track: '#16233f',
  text: '#e6eaf2',
  strong: '#f3f5fa',
  muted: '#a3aec2',
  border: '#2a3954',
  borderStrong: '#3a4a68',
  divider: '#1e2b45',
  button: ORANGE,
  onButton: NAVY,
  bad: '#f0807a',
  onBad: NAVY,
  good: '#5cc98b',
  warn: '#e9c46a',
  badBg: '#3a1c22',
  bookedBg: '#173826',
  bookedText: '#8fdcae',
  waitingBg: '#3a3115',
  waitingText: '#f0d36b',
  urgentBg: '#3d1d1d',
  urgentText: '#f4a8a2',
  urgentBorder: '#7a3a36',
};

/** The phone's setting picks the mode; anything unknown (or no preference) is light. */
export function schemeOf(device: string | null | undefined): Scheme {
  return device === 'dark' ? 'dark' : 'light';
}

export const paletteFor = (s: Scheme): Palette => (s === 'dark' ? DARK : LIGHT);

/** The status bar's icons: dark icons on the light page, light icons on the dark one. */
export const statusBarStyle = (s: Scheme): 'dark' | 'light' => (s === 'dark' ? 'light' : 'dark');

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio between two #rrggbb colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Text colour → the backgrounds it is drawn on in the app. Every pair must reach 4.5:1 (WCAG AA). */
export const TEXT_ON: [keyof Palette, (keyof Palette)[]][] = [
  ['text', ['bg', 'surface', 'track']],
  ['strong', ['bg', 'surface', 'track']],
  ['muted', ['bg', 'surface', 'track']],
  ['onButton', ['button']],
  ['onBad', ['bad']],
  ['bad', ['bg', 'surface', 'badBg']],
  ['good', ['bg', 'surface']],
  ['warn', ['bg', 'surface']],
  ['bookedText', ['bookedBg']],
  ['waitingText', ['waitingBg']],
  ['urgentText', ['urgentBg']],
];
