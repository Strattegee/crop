import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { api, ApiError, SignedOut } from './api';
import { addDays, dayLabel } from './format';
import {
  dayChip, firstDay, openOn, publishedMessage, publishLabel, shiftLine, summaryLine, unfilled, weekDates, weekRowsShown, weekStateLine, weekTitle,
  type RosterShift, type WeekRow,
} from './roster';
import { mondayOf, stageOf } from './shift';
import { styles } from './styles';

type Word = { one: string; many: string; lower: string; lowerMany: string };

/** Where the roster tab is looking; kept by ManagerHome so it survives opening a shift. */
export interface RosterView { weekStart: string; day: string | 'week'; facilityId: string | null }

const TONE = { urgent: styles.badgeUrgent, waiting: styles.badgeWaiting, booked: styles.badgeBooked, plain: null } as const;

/**
 * The roster in manager mode (backlog item 9a): one week at a time for one site or all, a day at a time or the
 * whole week, each shift with its stage in the roster's words; tap one to fill or change it. The week's Draft /
 * Live / History state per site and Publish (with or without telling staff), through the same endpoints as the web.
 */
export function RosterTab({ tenant, today, view, setView, word, people, siteWord, busyOutside, onOpen, onSignedOut }: {
  tenant: string; today?: string; view: RosterView; setView: (v: RosterView) => void; word: Word; people: Word; siteWord: Word;
  busyOutside: boolean; onOpen: (shiftId: string) => void; onSignedOut: () => void;
}) {
  const [shifts, setShifts] = useState<RosterShift[]>([]);
  const [weeks, setWeeks] = useState<WeekRow[]>([]);
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { weekStart, day, facilityId } = view;

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const site = facilityId ? `&facilityId=${facilityId}` : '';
      const [s, w] = await Promise.all([
        api<RosterShift[]>(`/shifts?from=${weekStart}&to=${addDays(weekStart, 6)}${site}`, { tenant }),
        api<WeekRow[]>(`/roster/weeks?weekStart=${weekStart}`, { tenant }),
      ]);
      setShifts(s);
      setWeeks(w);
    } catch (e) {
      if (e instanceof SignedOut) onSignedOut();
      else setError(e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }, [tenant, weekStart, facilityId, onSignedOut]);

  useEffect(() => {
    load();
  }, [load]);

  const goWeek = (start: string) => setView({ ...view, weekStart: start, day: day === 'week' ? 'week' : firstDay(start, today) });
  const shown = weekRowsShown(weeks, facilityId);
  const label = publishLabel(shown);
  const sites = weeks.map(w => ({ id: w.facilityId, name: w.facilityName }));

  const publish = () => {
    const where = facilityId ? weeks.find(w => w.facilityId === facilityId)?.facilityName : sites.length > 1 ? `every ${siteWord.lower}` : null;
    const tell = notify ? `${people.many} on it get their ${word.lowerMany} by email and text (after changes, only the people affected).` : 'No messages will be sent.';
    Alert.alert(`${label}${where ? ` for ${where}` : ''}?`, tell, [
      { text: 'Not now', style: 'cancel' },
      {
        text: 'Publish', onPress: async () => {
          setBusy(true);
          try {
            const r = await api<{ messages: number }>('/roster/publish', { method: 'POST', tenant, body: { weekStart, notify, ...(facilityId ? { facilityId } : {}) } });
            Alert.alert('Done', publishedMessage(r, notify, people, word));
          } catch (e) {
            if (e instanceof SignedOut) return onSignedOut();
            Alert.alert('Not done', e instanceof Error ? e.message : 'Something went wrong');
          }
          await load();
        },
      },
    ]);
  };

  const card = (s: RosterShift) => {
    const stage = stageOf(s);
    const who = s.equipmentOnly ? 'Equipment only' : s.workerName ? (s.agencyName ? `${s.workerName} (${s.agencyName})` : s.workerName) : 'Unfilled';
    return (
      <Pressable key={s.id} style={[styles.card, stage.tone === 'urgent' && styles.urgent, s.status === 'cancelled' && styles.disabled]} onPress={() => onOpen(s.id)}
        accessibilityRole="button" accessibilityHint={`Opens the ${word.lower} to fill or change it`}>
        <Text style={[styles.muted, styles.small, { marginTop: 0 }]}>{shiftLine(s)}{!facilityId && sites.length > 1 ? ` · ${s.facilityName}` : ''}</Text>
        <Text style={styles.cardTitle}>{who}</Text>
        {!!s.coveringName && <Text style={[styles.muted, styles.small]}>Covering {s.coveringName}</Text>}
        <Text style={[styles.badge, TONE[stage.tone]]}>{stage.label}</Text>
      </Pressable>
    );
  };

  const dates = weekDates(weekStart);
  const list = day === 'week' ? shifts : shifts.filter(s => s.localDate === day);

  return (
    <ScrollView contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={busy || busyOutside} onRefresh={load} />}>
      <View style={[styles.row, { marginTop: 0, alignItems: 'center' }]}>
        <Pressable style={styles.stepButton} onPress={() => goWeek(addDays(weekStart, -7))} accessibilityLabel="Previous week"><Text style={styles.stepText}>‹</Text></Pressable>
        <Pressable style={styles.grow} onPress={() => today && goWeek(mondayOf(today))} accessibilityHint="Goes to this week">
          <Text style={[styles.cardTitle, { textAlign: 'center' }]}>{weekTitle(weekStart, today)}</Text>
        </Pressable>
        <Pressable style={styles.stepButton} onPress={() => goWeek(addDays(weekStart, 7))} accessibilityLabel="Next week"><Text style={styles.stepText}>›</Text></Pressable>
      </View>

      {sites.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, { marginTop: 10 }]}>
          {[{ id: null as string | null, name: `All ${siteWord.lowerMany}` }, ...sites].map(f => {
            const on = facilityId === f.id;
            return (
              <Pressable key={f.id ?? 'all'} style={[styles.chip, on && styles.chipOn]} onPress={() => setView({ ...view, facilityId: f.id })}
                accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{f.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={[styles.card, { marginTop: 12 }]}>
        {shown.length === 0
          ? <Text style={styles.muted}>Draft · nothing on this week yet</Text>
          : shown.map(w => (
            <Text key={w.facilityId} style={{ marginBottom: 4 }}>
              <Text style={{ fontWeight: '700' }}>{shown.length > 1 || !facilityId ? `${w.facilityName}: ` : ''}</Text>
              <Text style={w.state === 'live' && w.changesSincePublish ? { color: '#8a5a00' } : styles.muted}>{weekStateLine(w, word)}</Text>
            </Text>
          ))}
        {label && (
          <>
            <Pressable style={[styles.chip, notify && styles.chipOn, { alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => setNotify(!notify)}
              accessibilityRole="checkbox" accessibilityState={{ checked: notify }}>
              <Text style={[styles.chipText, notify && styles.chipTextOn]}>{notify ? '✓ ' : ''}Tell {people.lowerMany}</Text>
            </Pressable>
            <Pressable style={[styles.button, { marginTop: 10 }]} disabled={busy} onPress={publish}><Text style={styles.buttonText}>{label}</Text></Pressable>
          </>
        )}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, { marginVertical: 8 }]}>
        {[...dates, 'week' as const].map(d => {
          const on = day === d;
          const open = d === 'week' ? shifts.filter(unfilled).length : openOn(shifts, d);
          return (
            <Pressable key={d} style={[styles.chip, on && styles.chipOn]} onPress={() => setView({ ...view, day: d })}
              accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityHint={open ? `${open} unfilled` : undefined}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{d === 'week' ? 'Whole week' : dayChip(d, today)}{open ? ` (${open})` : ''}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={[styles.muted, { marginBottom: 8 }]}>{summaryLine(list, word)}</Text>
      {day === 'week'
        ? dates.map(d => {
          const on = shifts.filter(s => s.localDate === d);
          if (!on.length) return null;
          return (
            <View key={d}>
              <Text style={styles.day}>{dayLabel(d, today)} · {summaryLine(on, word)}</Text>
              {on.map(card)}
            </View>
          );
        })
        : list.map(card)}
      {!busy && list.length === 0 && <Text style={styles.muted}>Add {word.lowerMany} on the web roster (Add {word.lowerMany}, or Templates and copying).</Text>}
    </ScrollView>
  );
}

