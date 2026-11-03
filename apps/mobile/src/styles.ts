import { StyleSheet } from 'react-native';
import { LIGHT, DARK, NAVY, ORANGE, type Palette, type Scheme } from './palette';

export { NAVY, ORANGE };

/** One sheet per mode, built from the palette (light and dark, 3 Nov). */
function makeStyles(p: Palette) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: p.bg },
    kpi: { width: 150, backgroundColor: p.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: p.border, borderLeftWidth: 4 },
    kpiOff: { borderLeftColor: p.bad, backgroundColor: p.badBg },
    kpiValue: { fontSize: 24, fontWeight: '700', color: p.strong, marginTop: 2 },
    kpiValueOff: { color: p.bad },
    kpiBad: { color: p.bad },
    kpiGood: { color: p.good },
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    title: { fontSize: 32, fontWeight: '700', color: p.strong },
    heading: { fontSize: 20, fontWeight: '700', color: p.strong },
    muted: { color: p.muted },
    small: { fontSize: 13, marginTop: 4 },
    error: { color: p.bad, marginVertical: 12 },
    header: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 8 },
    tabs: { flexDirection: 'row', marginHorizontal: 16, borderRadius: 8, backgroundColor: p.track, padding: 3 },
    tab: { flex: 1, paddingVertical: 10, paddingHorizontal: 2, alignItems: 'center', borderRadius: 6 },
    tabOn: { backgroundColor: p.surface },
    tabText: { color: p.muted, fontWeight: '600', fontSize: 13 },
    tabTextOn: { color: p.strong },
    list: { padding: 16, paddingBottom: 48 },
    day: { fontWeight: '700', marginTop: 12, marginBottom: 6, color: p.strong },
    card: { backgroundColor: p.surface, borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: p.border },
    cardTitle: { fontSize: 17, fontWeight: '600', marginBottom: 2 },
    badge: { alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden', fontSize: 13 },
    badgeBooked: { backgroundColor: p.bookedBg, color: p.bookedText },
    badgeWaiting: { backgroundColor: p.waitingBg, color: p.waitingText },
    badgeUrgent: { backgroundColor: p.urgentBg, color: p.urgentText },
    urgent: { borderColor: p.urgentBorder },
    row: { flexDirection: 'row', gap: 10, marginTop: 12 },
    grow: { flex: 1 },
    button: { backgroundColor: p.button, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, alignItems: 'center', marginTop: 16, minHeight: 44 },
    secondary: { backgroundColor: p.surface, borderWidth: 1, borderColor: p.strong },
    secondaryText: { color: p.strong },
    disabled: { opacity: 0.5 },
    buttonText: { color: p.onButton, fontWeight: '600', fontSize: 16 },
    /** A red button (cancelling a shift). */
    danger: { backgroundColor: p.bad },
    dangerText: { color: p.onBad },
    section: { fontSize: 17, fontWeight: '700', color: p.strong, marginTop: 20, marginBottom: 8 },
    dayRow: { backgroundColor: p.surface, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: p.border },
    dayHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: p.borderStrong, backgroundColor: p.surface, minHeight: 36 },
    chipOn: { backgroundColor: p.button, borderColor: p.button },
    chipText: { color: p.strong, fontWeight: '600' },
    chipTextOn: { color: p.onButton },
    stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 6 },
    stepButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: p.borderStrong, alignItems: 'center', justifyContent: 'center' },
    stepText: { fontSize: 20, color: p.strong },
    label: { fontWeight: '600', marginTop: 10, marginBottom: 4 },
    input: { backgroundColor: p.surface, color: p.text, borderWidth: 1, borderColor: p.borderStrong, borderRadius: 8, padding: 10, minHeight: 44 },
    stepMark: { width: 22, fontSize: 18, textAlign: 'center', color: p.muted },
    stepMarkDone: { color: p.good },
    link: { color: p.strong, textDecorationLine: 'underline', fontWeight: '600' },
    linkBad: { color: p.bad },
    goodText: { color: p.good },
    warnText: { color: p.warn },
    divider: { marginTop: 10, borderTopWidth: 1, borderTopColor: p.divider, paddingTop: 10 },
  });
}

type Styles = ReturnType<typeof makeStyles>;

const SHEETS: Record<Scheme, Styles> = { light: makeStyles(LIGHT), dark: makeStyles(DARK) };
let current: Scheme = 'light';

/**
 * Called by the app's root on every render with the phone's mode (`useColorScheme`), so the screens below,
 * which render again with it, pick up the right sheet.
 */
export function setScheme(s: Scheme): void {
  current = s;
}

export const schemeNow = (): Scheme => current;
export const colours = (): Palette => (current === 'dark' ? DARK : LIGHT);

/** The current mode's styles: `styles.card` reads the light or dark sheet. */
export const styles = new Proxy({} as Styles, {
  get: (_target, key) => SHEETS[current][key as keyof Styles],
}) as Styles;
