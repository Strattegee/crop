import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { api, ApiError, SignedOut } from './api';
import {
  approvedLeaveMessage, attentionHeading, canDecide, changeRequestShift, KIND_LABEL, kpiNote, kpiOrder, kpiValue, leaveRequestLine, requestsTab, shiftWhere, shiftWord, todayIn,
  type Attention, type ChangeRequest, type Dashboard, type LeaveRequest, type Term,
} from './manager';
import { currentWeek, firstDay, termWord } from './roster';
import { RosterTab, type RosterView } from './RosterTab';
import { ShiftScreen } from './ShiftScreen';
import { styles } from './styles';

type Tab = 'today' | 'roster' | 'requests';

/**
 * Manager mode (backlog item 9a, first slice): for owners, admins and allocators running the roster from a phone.
 * Today = Needs attention for the next 7 days (the same list as the web's roster and Dashboard); Requests = leave
 * and roster change requests waiting, which owners and admins approve or decline here. Everything goes through
 * the same endpoints and rules as the web.
 */
export function ManagerHome({ tenant, business, role, onMyShifts, switchable, onSwitch, onSignOut, onSignedOut }: {
  tenant: string; business: string; role: string; onMyShifts: (() => void) | null;
  switchable: boolean; onSwitch: () => void; onSignOut: () => void; onSignedOut: () => void;
}) {
  const [tab, setTab] = useState<Tab>('today');
  const [attention, setAttention] = useState<Attention | null>(null);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [leave, setLeave] = useState<LeaveRequest[]>([]);
  const [changes, setChanges] = useState<ChangeRequest[]>([]);
  const [terms, setTerms] = useState<Term[] | null>(null);
  const [today, setToday] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openShift, setOpenShift] = useState<string | null>(null);
  const [rosterView, setRosterView] = useState<RosterView | null>(null);
  const decider = canDecide(role);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [a, l, c, t, s, d] = await Promise.all([
        api<Attention>('/roster/attention', { tenant }),
        api<LeaveRequest[]>('/leave?status=requested', { tenant }),
        api<ChangeRequest[]>('/roster/change-requests', { tenant }),
        api<Term[]>('/terms', { tenant }).catch(() => null),
        api<{ timezone?: string }>('/settings', { tenant }).catch(() => null),
        api<Dashboard>('/dashboard', { tenant }).catch(() => null),
      ]);
      setDash(d);
      setAttention(a);
      setLeave(l);
      setChanges(c);
      setTerms(t);
      const day = todayIn(s?.timezone);
      setToday(day);
      setRosterView(v => {
        if (v) return v;
        const weekStart = currentWeek(day, new Date().toISOString().slice(0, 10));
        return { weekStart, day: firstDay(weekStart, day), facilityId: null };
      });
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

  const word = shiftWord(terms);
  const people = termWord(terms, 'worker', 'Worker', 'Workers');
  const siteWord = termWord(terms, 'site', 'Site', 'Sites');
  const rosterWord = termWord(terms, 'roster', 'Roster', 'Rosters');

  const act = async (path: string, done: (result: unknown) => string) => {
    setBusy(true);
    try {
      const result = await api(path, { method: 'POST', tenant, body: {} });
      Alert.alert('Done', done(result));
    } catch (e) {
      if (e instanceof SignedOut) return onSignedOut();
      Alert.alert('Not done', e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');
    }
    await load();
  };

  const decideLeave = (l: LeaveRequest, answer: 'approve' | 'decline') =>
    act(`/leave/${l.id}/${answer}`, r => answer === 'approve'
      ? approvedLeaveMessage(((r as { rostered?: unknown[] }).rostered ?? []).length, word)
      : 'Declined.');

  const decideChange = (r: ChangeRequest, answer: 'approve' | 'decline') =>
    act(`/change-requests/${r.id}/${answer}`, () => (answer === 'approve' ? 'Approved and changed on the roster.' : 'Declined. They have been told by email.'));

  const confirm = (title: string, run: () => void) =>
    Alert.alert(title, undefined, [{ text: 'Not now', style: 'cancel' }, { text: 'Yes', onPress: run }]);

  if (openShift) {
    return <ShiftScreen tenant={tenant} shiftId={openShift} today={today} word={word} onSignedOut={onSignedOut}
      onBack={() => { setOpenShift(null); load(); }} />;
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>{business}</Text>
          <Text style={styles.muted}>Running the roster</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          {onMyShifts && <Pressable onPress={onMyShifts}><Text style={styles.link}>My {word.lowerMany}</Text></Pressable>}
          {switchable && <Pressable onPress={onSwitch}><Text style={styles.link}>Switch</Text></Pressable>}
        </View>
      </View>
      <View style={styles.tabs}>
        {(['today', 'roster', 'requests'] as const).map(t => (
          <Pressable key={t} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
            <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t === 'today' ? 'Needs attention' : t === 'roster' ? rosterWord.one : requestsTab(leave.length, changes.length)}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'roster' && rosterView ? (
        <RosterTab tenant={tenant} today={today} view={rosterView} setView={setRosterView} word={word} people={people} siteWord={siteWord}
          busyOutside={busy} onOpen={setOpenShift} onSignedOut={onSignedOut} />
      ) : (
      <ScrollView contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />}>
        {error && <Text style={styles.error}>{error}</Text>}

        {tab === 'today' && dash && dash.kpis.length > 0 && (
          <>
            <Text style={[styles.muted, styles.small, { marginTop: 0 }]}>Your {dash.label} numbers</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16, marginBottom: 12 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
              {kpiOrder(dash.kpis).map(k => {
                const note = kpiNote(k);
                return (
                  <View key={k.key} style={[styles.kpi, k.standing === 'off_target' && styles.kpiOff]} accessible accessibilityLabel={`${k.label}: ${kpiValue(k.value, k.unit)}. ${note.text}`}>
                    <Text style={[styles.muted, styles.small, { marginTop: 0 }]}>{k.label}</Text>
                    <Text style={[styles.kpiValue, k.standing === 'off_target' && styles.kpiValueOff]}>{kpiValue(k.value, k.unit)}</Text>
                    {!!note.text && <Text style={[styles.small, note.tone === 'bad' ? styles.kpiBad : note.tone === 'good' ? styles.kpiGood : styles.muted]} numberOfLines={2}>{note.text}</Text>}
                  </View>
                );
              })}
            </ScrollView>
          </>
        )}

        {tab === 'today' && attention && (
          <>
            <Text style={[styles.muted, { marginBottom: 8 }]}>{attentionHeading(attention)}</Text>
            {attention.items.map(i => (
              <Pressable key={`${i.kind}-${i.shiftId}`} style={[styles.card, i.urgent && styles.urgent]} onPress={() => setOpenShift(i.shiftId)}
                accessibilityRole="button" accessibilityHint={`Opens the ${word.lower} to fill or change it`}>
                <Text style={[styles.badge, i.urgent ? styles.badgeUrgent : styles.badgeWaiting, { marginTop: 0, marginBottom: 6 }]}>
                  {KIND_LABEL[i.kind]} · {i.startsIn}
                </Text>
                <Text style={styles.cardTitle}>{i.title}</Text>
                {!!i.detail && <Text>{i.detail}</Text>}
                <Text style={[styles.muted, styles.small]}>{shiftWhere(i.shift, today)}</Text>
                <Text style={[styles.link, styles.small]}>Open ›</Text>
              </Pressable>
            ))}
            {attention.truncated && <Text style={[styles.muted, styles.small]}>The list was cut short; the roster on the web has the rest.</Text>}
          </>
        )}

        {tab === 'requests' && (
          <>
            <Text style={styles.section}>Leave waiting for a decision</Text>
            {leave.length === 0 ? <Text style={styles.muted}>None waiting.</Text> : leave.map(l => (
              <View key={l.id} style={styles.card}>
                <Text style={styles.cardTitle}>{leaveRequestLine(l)}</Text>
                {!!l.note && <Text style={[styles.muted, styles.small]}>{l.note}</Text>}
                {decider ? (
                  <View style={styles.row}>
                    <Pressable style={[styles.button, styles.grow]} disabled={busy} onPress={() => confirm(`Approve leave for ${l.workerName}?`, () => decideLeave(l, 'approve'))}>
                      <Text style={styles.buttonText}>Approve</Text>
                    </Pressable>
                    <Pressable style={[styles.button, styles.secondary, styles.grow]} disabled={busy} onPress={() => confirm(`Decline leave for ${l.workerName}?`, () => decideLeave(l, 'decline'))}>
                      <Text style={[styles.buttonText, styles.secondaryText]}>Decline</Text>
                    </Pressable>
                  </View>
                ) : <Text style={[styles.muted, styles.small]}>An owner or admin decides.</Text>}
              </View>
            ))}

            <Text style={styles.section}>Roster changes waiting for approval</Text>
            {changes.length === 0 ? <Text style={styles.muted}>None waiting.</Text> : changes.map(r => (
              <View key={r.id} style={styles.card}>
                <Text style={styles.cardTitle}>{r.summary}</Text>
                <Text style={[styles.muted, styles.small]}>{changeRequestShift(r, today)}</Text>
                {!!r.requestedByName && <Text style={[styles.muted, styles.small]}>Asked by {r.requestedByName}{r.reason ? `: ${r.reason}` : ''}</Text>}
                {r.canDecide ? (
                  <View style={styles.row}>
                    <Pressable style={[styles.button, styles.grow]} disabled={busy} onPress={() => confirm('Approve and make this change?', () => decideChange(r, 'approve'))}>
                      <Text style={styles.buttonText}>Approve</Text>
                    </Pressable>
                    <Pressable style={[styles.button, styles.secondary, styles.grow]} disabled={busy} onPress={() => confirm('Decline this change?', () => decideChange(r, 'decline'))}>
                      <Text style={[styles.buttonText, styles.secondaryText]}>Decline</Text>
                    </Pressable>
                  </View>
                ) : <Text style={[styles.muted, styles.small]}>An owner or admin decides.</Text>}
              </View>
            ))}
          </>
        )}

        <Pressable onPress={onSignOut} style={{ marginTop: 24, alignSelf: 'center' }}><Text style={styles.link}>Sign out</Text></Pressable>
      </ScrollView>
      )}
    </View>
  );
}
