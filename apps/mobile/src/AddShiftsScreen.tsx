import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from './ui';
import { api, ApiError, SignedOut } from './api';
import { dayChip } from './roster';
import {
  addableDays, addCount, addedMessage, addLabel, addShiftsBody, codeChoices, codeLabel, defaultDays, defaultSite, hoursLine, roleChoices,
  siteChoices, tidyTime, toggleDay, type AddForm, type AreaRow, type RoleRow, type ShiftCodeRow, type SiteRow,
} from './add-shifts';
import { styles } from './styles';

type Word = { one: string; many: string; lower: string; lowerMany: string };

function Chip({ on, label, onPress, disabled }: { on: boolean; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable style={[styles.chip, on && styles.chipOn, disabled && styles.disabled]} onPress={onPress} disabled={disabled}
      accessibilityRole="button" accessibilityState={{ selected: on, disabled }}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Adding shifts from the phone (backlog item 9a, 7 Nov): owners, admins and allocators add open shifts to the week
 * on screen, on one or several days, from a shift type or typed times, through `POST /shifts` like the web's Add
 * shifts (so the after-publishing rule and every check are the API's). Filling them stays on the roster.
 */
export function AddShiftsScreen({ tenant, weekStart, day, facilityId, today, word, siteWord, onBack, onAdded, onSignedOut }: {
  tenant: string; weekStart: string; day: string | 'week'; facilityId: string | null; today?: string;
  word: Word; siteWord: Word; onBack: () => void; onAdded: (facilityId: string) => void; onSignedOut: () => void;
}) {
  const [sites, setSites] = useState<{ id: string; label: string }[] | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [areas, setAreas] = useState<AreaRow[]>([]);
  const [codes, setCodes] = useState<ShiftCodeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<AddForm>({
    facilityId: null, areaId: null, shiftCodeId: null, startTime: '', endTime: '', breakMinutes: '30', role: '',
    days: defaultDays(weekStart, day, today), quantity: 1, notes: '',
  });
  const set = (p: Partial<AddForm>) => setF(x => ({ ...x, ...p }));

  const fail = (e: unknown) => {
    if (e instanceof SignedOut) return onSignedOut();
    setError(e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');
  };

  useEffect(() => {
    (async () => {
      try {
        const [s, r] = await Promise.all([api<SiteRow[]>('/facilities', { tenant }), api<RoleRow[]>('/roles', { tenant })]);
        const choices = siteChoices(s);
        setSites(choices);
        setRoles(roleChoices(r));
        set({ facilityId: defaultSite(choices, facilityId) });
      } catch (e) {
        fail(e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);

  // Areas and shift types follow the site.
  useEffect(() => {
    if (!f.facilityId) return;
    let live = true;
    (async () => {
      try {
        const [site, c] = await Promise.all([
          api<{ areas: AreaRow[] }>(`/facilities/${f.facilityId}`, { tenant }),
          api<ShiftCodeRow[]>(`/shift-codes?facilityId=${f.facilityId}`, { tenant }),
        ]);
        if (!live) return;
        setAreas(site.areas.filter(a => a.active));
        setCodes(codeChoices(c));
        setF(x => ({ ...x, areaId: null, shiftCodeId: null }));
      } catch (e) {
        fail(e);
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, f.facilityId]);

  const days = useMemo(() => addableDays(weekStart, today), [weekStart, today]);
  const code = codes.find(c => c.id === f.shiftCodeId) ?? null;
  const hours = code ? hoursLine(code.startTime, code.endTime, code.breakMinutes) : hoursLine(tidyTime(f.startTime), tidyTime(f.endTime), Number(f.breakMinutes) || 0);
  const n = addCount(f);

  const add = async () => {
    const r = addShiftsBody(f, word, siteWord);
    if ('problem' in r) return setError(r.problem);
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ created: number }>('/shifts', { method: 'POST', tenant, body: r.body });
      Alert.alert('Done', addedMessage(out.created, f.days, word));
      onAdded(f.facilityId!);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
      <Pressable onPress={onBack} accessibilityRole="button"><Text style={styles.link}>‹ Back</Text></Pressable>
      <Text style={[styles.heading, { marginTop: 8 }]}>Add {word.lowerMany}</Text>
      <Text style={[styles.muted, styles.small]}>They go on the {siteWord.lower}'s roster as open {word.lowerMany}; fill them from the roster.</Text>
      {!sites ? (error ? <Text style={styles.error}>{error}</Text> : <Text style={styles.muted}>Loading…</Text>) : sites.length === 0 ? (
        <Text style={styles.muted}>Add a {siteWord.lower} on the web first.</Text>
      ) : (
        <>
          {sites.length > 1 && (
            <>
              <Text style={styles.label}>{siteWord.one}</Text>
              <View style={styles.chips}>{sites.map(s => <Chip key={s.id} on={f.facilityId === s.id} label={s.label} onPress={() => set({ facilityId: s.id })} />)}</View>
            </>
          )}

          <Text style={styles.label}>Days</Text>
          <View style={styles.chips}>
            {days.map(d => <Chip key={d.date} on={f.days.includes(d.date)} disabled={d.past} label={dayChip(d.date, today)} onPress={() => set({ days: toggleDay(f.days, d.date) })} />)}
          </View>

          <Text style={styles.label}>Times</Text>
          <View style={styles.chips}>
            {codes.map(c => <Chip key={c.id} on={f.shiftCodeId === c.id} label={codeLabel(c)} onPress={() => set({ shiftCodeId: c.id })} />)}
            <Chip on={!f.shiftCodeId} label="Type the times" onPress={() => set({ shiftCodeId: null })} />
          </View>
          {!f.shiftCodeId && (
            <View style={[styles.row, { marginTop: 8 }]}>
              <View style={styles.grow}>
                <Text style={[styles.muted, styles.small]}>Start</Text>
                <TextInput style={styles.input} value={f.startTime} onChangeText={v => set({ startTime: v })} placeholder="7:00" keyboardType="numbers-and-punctuation" maxLength={5}
                  onBlur={() => { const t = tidyTime(f.startTime); if (t) set({ startTime: t }); }} accessibilityLabel="Start time" />
              </View>
              <View style={styles.grow}>
                <Text style={[styles.muted, styles.small]}>Finish</Text>
                <TextInput style={styles.input} value={f.endTime} onChangeText={v => set({ endTime: v })} placeholder="15:30" keyboardType="numbers-and-punctuation" maxLength={5}
                  onBlur={() => { const t = tidyTime(f.endTime); if (t) set({ endTime: t }); }} accessibilityLabel="Finish time" />
              </View>
              <View style={styles.grow}>
                <Text style={[styles.muted, styles.small]}>Break (min)</Text>
                <TextInput style={styles.input} value={f.breakMinutes} onChangeText={v => set({ breakMinutes: v.replace(/\D/g, '') })} keyboardType="number-pad" maxLength={3}
                  accessibilityLabel="Break in minutes" />
              </View>
            </View>
          )}
          {hours && <Text style={[styles.muted, styles.small]}>{hours}</Text>}

          <Text style={styles.label}>Role</Text>
          {roles.length > 0 && (
            <View style={styles.chips}>{roles.map(r => <Chip key={r} on={f.role === r} label={r} onPress={() => set({ role: r })} />)}</View>
          )}
          <TextInput style={[styles.input, { marginTop: 8 }]} value={f.role} onChangeText={v => set({ role: v })} placeholder={roles.length ? 'Or type a role' : 'Role, e.g. Cook'} maxLength={60}
            accessibilityLabel="Role" />

          {areas.length > 0 && (
            <>
              <Text style={styles.label}>Area (optional)</Text>
              <View style={styles.chips}>
                <Chip on={!f.areaId} label="No area" onPress={() => set({ areaId: null })} />
                {areas.map(a => <Chip key={a.id} on={f.areaId === a.id} label={a.name} onPress={() => set({ areaId: a.id })} />)}
              </View>
            </>
          )}

          <Text style={styles.label}>How many each day</Text>
          <View style={styles.stepper}>
            <Pressable style={styles.stepButton} onPress={() => set({ quantity: Math.max(1, f.quantity - 1) })} accessibilityLabel="One fewer"><Text style={styles.stepText}>−</Text></Pressable>
            <Text style={styles.cardTitle}>{f.quantity}</Text>
            <Pressable style={styles.stepButton} onPress={() => set({ quantity: Math.min(20, f.quantity + 1) })} accessibilityLabel="One more"><Text style={styles.stepText}>+</Text></Pressable>
          </View>

          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput style={styles.input} value={f.notes} onChangeText={v => set({ notes: v })} maxLength={1000} multiline accessibilityLabel="Notes" />

          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable style={[styles.button, { marginTop: 16 }, (busy || !n) && styles.disabled]} disabled={busy || !n} onPress={add}>
            <Text style={styles.buttonText}>{busy ? 'Adding…' : addLabel(n, word)}</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}
