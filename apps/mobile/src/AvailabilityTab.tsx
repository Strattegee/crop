import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { api, ApiError, SignedOut } from './api';
import {
  addDays, chipOn, dayLabel, LEAVE_KIND_LABEL, LEAVE_KINDS, LEAVE_STATUS_LABEL, leaveAskedMessage, leaveDates, patternBody,
  PERIOD_LABEL, PERIODS, periodsLabel, toggleDay, WEEKDAYS, type DayChip, type LeaveKind, type MyLeave, type Period,
} from './format';
import { styles } from './styles';

type Availability = {
  today: string;
  pattern: { weekday: number; periods: Period[] }[];
  dates: { date: string; periods: Period[]; note: string | null }[];
  leave: MyLeave[];
};
type Week = Record<number, Period[] | undefined>;
type Word = { lower: string; lowerMany: string };

const CHIPS: DayChip[] = [...PERIODS, 'off'];
const chipLabel = (c: DayChip) => (c === 'off' ? 'Off' : PERIOD_LABEL[c]);

function Chips({ value, onChange }: { value: Period[] | undefined; onChange: (v: Period[] | undefined) => void }) {
  return (
    <View style={styles.chips}>
      {CHIPS.map(c => {
        const on = chipOn(value, c);
        return (
          <Pressable key={c} style={[styles.chip, on && styles.chipOn]} onPress={() => onChange(toggleDay(value, c))}
            accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{chipLabel(c)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Stepper({ label, onBack, onNext, backDisabled }: { label: string; onBack: () => void; onNext: () => void; backDisabled?: boolean }) {
  return (
    <View style={styles.stepper}>
      <Pressable style={[styles.stepButton, backDisabled && styles.disabled]} disabled={backDisabled} onPress={onBack} accessibilityLabel="Earlier">
        <Text style={styles.stepText}>‹</Text>
      </Pressable>
      <Text style={styles.cardTitle}>{label}</Text>
      <Pressable style={styles.stepButton} onPress={onNext} accessibilityLabel="Later"><Text style={styles.stepText}>›</Text></Pressable>
    </View>
  );
}

/** The worker app's Availability tab: usual week, changes for particular dates, and leave. */
export function AvailabilityTab({ tenant, word, onSignedOut, footer }: { tenant: string; word: Word; onSignedOut: () => void; footer: ReactNode }) {
  const [data, setData] = useState<Availability | null>(null);
  const [week, setWeek] = useState<Week>({});
  const [weekChanged, setWeekChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A change for one date.
  const [onDate, setOnDate] = useState<string | null>(null);
  const [datePeriods, setDatePeriods] = useState<Period[] | undefined>([]);
  // Asking for leave.
  const [asking, setAsking] = useState(false);
  const [kind, setKind] = useState<LeaveKind>('annual');
  const [leaveStart, setLeaveStart] = useState<string | null>(null);
  const [leaveDays, setLeaveDays] = useState(1);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const a = await api<Availability>('/my/availability', { tenant });
      setData(a);
      setWeek(Object.fromEntries(a.pattern.map(p => [p.weekday, p.periods])));
      setWeekChanged(false);
    } catch (e) {
      if (e instanceof SignedOut) onSignedOut();
      else setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }, [tenant, onSignedOut]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    try {
      const done = await fn();
      if (done) Alert.alert(done);
      await load();
      return true;
    } catch (e) {
      if (e instanceof SignedOut) onSignedOut();
      else Alert.alert('Not saved', e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');
      setBusy(false);
      return false;
    }
  };

  const saveWeek = () => run(async () => {
    await api('/my/availability/pattern', { method: 'PUT', tenant, body: patternBody(week) });
    return 'Your usual week is saved';
  });

  const saveDate = () => onDate && run(async () => {
    if (datePeriods === undefined) await api(`/my/availability/dates/${onDate}`, { method: 'DELETE', tenant });
    else await api(`/my/availability/dates/${onDate}`, { method: 'PUT', tenant, body: { periods: datePeriods } });
    return null;
  }).then(ok => ok && setOnDate(null));

  const removeDate = (d: string) => run(async () => {
    await api(`/my/availability/dates/${d}`, { method: 'DELETE', tenant });
    return null;
  });

  const askLeave = () => leaveStart && run(async () => {
    const r = await api<{ shiftsDuring: number }>('/my/leave', {
      method: 'POST', tenant,
      body: { kind, startsOn: leaveStart, endsOn: addDays(leaveStart, leaveDays - 1), note: note.trim() || null },
    });
    return `Leave asked for. ${leaveAskedMessage(r.shiftsDuring, word)}`;
  }).then(ok => ok && (setAsking(false), setNote(''), setLeaveDays(1)));

  const withdraw = (l: MyLeave) => Alert.alert('Withdraw this request?', leaveDates(l), [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Withdraw', style: 'destructive', onPress: () => run(async () => { await api(`/my/leave/${l.id}/cancel`, { method: 'POST', tenant }); return null; }) },
  ]);

  const today = data?.today;
  return (
    <ScrollView contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />}>
      {error && <Text style={styles.error}>{error}</Text>}
      {data && today && (
        <>
          <Text style={[styles.section, { marginTop: 0 }]}>My usual week</Text>
          <Text style={[styles.muted, styles.small, { marginBottom: 8 }]}>When you can usually work. The office sees this when filling {word.lowerMany}.</Text>
          {WEEKDAYS.map(d => (
            <View key={d.weekday} style={styles.dayRow}>
              <View style={styles.dayHead}>
                <Text style={{ fontWeight: '600' }}>{d.name}</Text>
                <Text style={styles.muted}>{periodsLabel(week[d.weekday])}</Text>
              </View>
              <Chips value={week[d.weekday]} onChange={v => { setWeek({ ...week, [d.weekday]: v }); setWeekChanged(true); }} />
            </View>
          ))}
          {weekChanged && (
            <Pressable style={styles.button} disabled={busy} onPress={saveWeek}><Text style={styles.buttonText}>Save my usual week</Text></Pressable>
          )}

          <Text style={styles.section}>Changes for a date</Text>
          {data.dates.length === 0 && !onDate && <Text style={styles.muted}>None. Add one if a day is different from your usual week.</Text>}
          {data.dates.map(d => (
            <View key={d.date} style={[styles.card, { flexDirection: 'row', alignItems: 'center' }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600' }}>{dayLabel(d.date, today)}</Text>
                <Text style={styles.muted}>{periodsLabel(d.periods)}</Text>
              </View>
              <Pressable onPress={() => removeDate(d.date)} disabled={busy}><Text style={styles.link}>Remove</Text></Pressable>
            </View>
          ))}
          {onDate ? (
            <View style={styles.card}>
              <Stepper label={dayLabel(onDate, today)} backDisabled={onDate <= today}
                onBack={() => setOnDate(addDays(onDate, -1))} onNext={() => setOnDate(addDays(onDate, 1))} />
              <Chips value={datePeriods} onChange={setDatePeriods} />
              <Text style={[styles.muted, styles.small]}>{datePeriods === undefined ? 'Your usual week applies that day' : periodsLabel(datePeriods)}</Text>
              <View style={styles.row}>
                <Pressable style={[styles.button, styles.grow]} disabled={busy} onPress={saveDate}><Text style={styles.buttonText}>Save</Text></Pressable>
                <Pressable style={[styles.button, styles.secondary, styles.grow]} onPress={() => setOnDate(null)}>
                  <Text style={[styles.buttonText, styles.secondaryText]}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable style={[styles.button, styles.secondary]} onPress={() => { setOnDate(addDays(today, 1)); setDatePeriods([]); }}>
              <Text style={[styles.buttonText, styles.secondaryText]}>Add a change</Text>
            </Pressable>
          )}

          <Text style={styles.section}>Leave</Text>
          {data.leave.length === 0 && !asking && <Text style={styles.muted}>No leave coming up.</Text>}
          {data.leave.map(l => (
            <View key={l.id} style={styles.card}>
              <Text style={{ fontWeight: '600' }}>{leaveDates(l)}</Text>
              <Text style={styles.muted}>{LEAVE_KIND_LABEL[l.kind]} · {LEAVE_STATUS_LABEL[l.status] ?? l.status}</Text>
              {l.status === 'requested' && (
                <Pressable onPress={() => withdraw(l)} disabled={busy} style={{ marginTop: 8 }}><Text style={styles.link}>Withdraw request</Text></Pressable>
              )}
            </View>
          ))}
          {asking && leaveStart ? (
            <View style={styles.card}>
              <Text style={styles.label}>Kind of leave</Text>
              <View style={styles.chips}>
                {LEAVE_KINDS.map(k => (
                  <Pressable key={k} style={[styles.chip, kind === k && styles.chipOn]} onPress={() => setKind(k)}
                    accessibilityRole="radio" accessibilityState={{ selected: kind === k }}>
                    <Text style={[styles.chipText, kind === k && styles.chipTextOn]}>{LEAVE_KIND_LABEL[k]}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.label}>First day</Text>
              <Stepper label={dayLabel(leaveStart, today)} backDisabled={leaveStart <= today}
                onBack={() => setLeaveStart(addDays(leaveStart, -1))} onNext={() => setLeaveStart(addDays(leaveStart, 1))} />
              <Text style={styles.label}>How many days</Text>
              <Stepper label={`${leaveDays} day${leaveDays === 1 ? '' : 's'}`} backDisabled={leaveDays <= 1}
                onBack={() => setLeaveDays(leaveDays - 1)} onNext={() => setLeaveDays(Math.min(leaveDays + 1, 366))} />
              <Text style={[styles.muted, styles.small]}>{leaveDates({ startsOn: leaveStart, endsOn: addDays(leaveStart, leaveDays - 1) })}</Text>
              <Text style={styles.label}>Note for the office (optional)</Text>
              <TextInput style={styles.input} value={note} onChangeText={setNote} maxLength={300} multiline
                placeholder="Please don't include health details" />
              <View style={styles.row}>
                <Pressable style={[styles.button, styles.grow]} disabled={busy} onPress={askLeave}><Text style={styles.buttonText}>Ask for leave</Text></Pressable>
                <Pressable style={[styles.button, styles.secondary, styles.grow]} onPress={() => setAsking(false)}>
                  <Text style={[styles.buttonText, styles.secondaryText]}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable style={[styles.button, styles.secondary]} onPress={() => { setAsking(true); setLeaveStart(addDays(today, 1)); }}>
              <Text style={[styles.buttonText, styles.secondaryText]}>Ask for leave</Text>
            </Pressable>
          )}
        </>
      )}
      {footer}
    </ScrollView>
  );
}
