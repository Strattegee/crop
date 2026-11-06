import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from './ui';
import { api, ApiError, SignedOut } from './api';
import {
  approvedLeaveMessage, attentionHeading, canDecide, changeRequestShift, kindLabel, kpiNote, kpiOrder, kpiValue, leaveRequestLine, managerCan, managerLine, requestsTab, shiftWhere, shiftWord, todayIn,
  type Attention, type ChangeRequest, type Dashboard, type LeaveRequest, type Term,
} from './manager';
import { currentWeek, firstDay, termWord } from './roster';
import { RosterTab, type RosterView } from './RosterTab';
import { ProjectsTab } from './ProjectsTab';
import { PeopleTab } from './PeopleTab';
import type { PersonRow } from './people';
import type { ProjectRow } from './projects';
import { ShiftScreen } from './ShiftScreen';
import { AlertsScreen } from './AlertsScreen';
import { AddShiftsScreen } from './AddShiftsScreen';
import { styles } from './styles';

type Tab = 'today' | 'roster' | 'people' | 'projects' | 'requests';

/**
 * Manager mode (backlog item 9a, first slice): for owners, admins and allocators running the roster from a phone.
 * Today = Needs attention for the next 7 days (the same list as the web's roster and Dashboard); Requests = leave
 * and roster change requests waiting, which owners and admins approve or decline here. Everything goes through
 * the same endpoints and rules as the web. Projects (6 Nov) shows only when the person can see any (`ProjectsTab`);
 * People (6 Nov) lists who they can see (`PeopleTab`; a supervisor only their sites' people, in the API's limited view).
 */
export function ManagerHome({ tenant, business, role, openTab, onMyShifts, switchable, onSwitch, onSignOut, onSignedOut }: {
  tenant: string; business: string; role: string; onMyShifts: (() => void) | null;
  /** A tapped office alert: the tab to open (`n` changes with every tap). */
  openTab?: { tab: 'today' | 'requests'; n: number } | null;
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
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [staff, setStaff] = useState<PersonRow[]>([]);
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const decider = canDecide(role);
  const can = managerCan(role);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [a, l, c, t, s, d, p, w] = await Promise.all([
        api<Attention>('/roster/attention', { tenant }),
        can.leave ? api<LeaveRequest[]>('/leave?status=requested', { tenant }) : Promise.resolve([] as LeaveRequest[]),
        api<ChangeRequest[]>('/roster/change-requests', { tenant }),
        api<Term[]>('/terms', { tenant }).catch(() => null),
        api<{ timezone?: string }>('/settings', { tenant }).catch(() => null),
        api<Dashboard>('/dashboard', { tenant }).catch(() => null),
        api<ProjectRow[]>('/projects', { tenant }).catch(() => [] as ProjectRow[]),
        api<PersonRow[]>('/workers?status=active', { tenant }).catch(() => [] as PersonRow[]),
      ]);
      setStaff(w);
      setProjects(p);
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
  }, [tenant, onSignedOut, can.leave]);

  useEffect(() => {
    load();
  }, [load]);

  // A tapped alert opens its tab, fresh.
  useEffect(() => {
    if (!openTab) return;
    setOpenShift(null);
    setAlertsOpen(false);
    setTab(openTab.tab);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTab?.n, openTab?.tab]);

  const word = shiftWord(terms);
  const people = termWord(terms, 'worker', 'Worker', 'Workers');
  const siteWord = termWord(terms, 'site', 'Site', 'Sites');
  const rosterWord = termWord(terms, 'roster', 'Roster', 'Rosters');
  const equipmentWord = termWord(terms, 'equipment', 'Equipment', 'Equipment');
  const projectWord = termWord(terms, 'project', 'Project', 'Projects');
  const credentialWord = termWord(terms, 'credential', 'Credential', 'Credentials');
  const tabs: Tab[] = projects.length > 0 ? ['today', 'roster', 'people', 'projects', 'requests'] : ['today', 'roster', 'people', 'requests'];
  // Five tabs don't fit "Needs attention" on a phone.
  const tabLabel = (t: Tab) => t === 'today' ? (tabs.length > 4 ? 'Attention' : 'Needs attention') : t === 'roster' ? rosterWord.one
    : t === 'people' ? people.many : t === 'projects' ? projectWord.many : requestsTab(leave.length, changes.length);
  const rosterAt = (facilityId: string, day: string) => {
    const weekStart = currentWeek(day, day);
    setRosterView({ weekStart, day: firstDay(weekStart, day), facilityId });
    setTab('roster');
  };

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
    act(`/change-requests/${r.id}/${answer}`, () => (answer === 'approve' ? `Approved and changed on the ${rosterWord.lower}.` : 'Declined. They have been told by email.'));

  const confirm = (title: string, run: () => void) =>
    Alert.alert(title, undefined, [{ text: 'Not now', style: 'cancel' }, { text: 'Yes', onPress: run }]);

  if (alertsOpen) {
    return <AlertsScreen tenant={tenant} word={word} rosterWord={rosterWord} onBack={() => setAlertsOpen(false)} onSignedOut={onSignedOut} />;
  }

  if (adding && rosterView) {
    return <AddShiftsScreen tenant={tenant} weekStart={rosterView.weekStart} day={rosterView.day} facilityId={rosterView.facilityId} today={today}
      word={word} siteWord={siteWord} onBack={() => setAdding(false)} onSignedOut={onSignedOut}
      onAdded={site => { setAdding(false); if (rosterView.facilityId && rosterView.facilityId !== site) setRosterView({ ...rosterView, facilityId: site }); load(); }} />;
  }

  if (openShift) {
    return <ShiftScreen tenant={tenant} shiftId={openShift} role={role} today={today} word={word} equipmentWord={equipmentWord} onSignedOut={onSignedOut}
      onBack={() => { setOpenShift(null); load(); }} />;
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>{business}</Text>
          <Text style={styles.muted}>{managerLine(role, rosterWord)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          {onMyShifts && <Pressable onPress={onMyShifts}><Text style={styles.link}>My {word.lowerMany}</Text></Pressable>}
          {switchable && <Pressable onPress={onSwitch}><Text style={styles.link}>Switch</Text></Pressable>}
          <Pressable onPress={() => setAlertsOpen(true)} accessibilityRole="button"><Text style={styles.link}>Alerts</Text></Pressable>
        </View>
      </View>
      <View style={styles.tabs}>
        {tabs.map(t => (
          <Pressable key={t} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
            <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{tabLabel(t)}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'roster' && rosterView ? (
        <RosterTab tenant={tenant} role={role} today={today} view={rosterView} setView={setRosterView} word={word} people={people} siteWord={siteWord} equipmentWord={equipmentWord}
          busyOutside={busy} onOpen={setOpenShift} onAdd={can.add ? () => setAdding(true) : undefined} onSignedOut={onSignedOut} />
      ) : tab === 'people' ? (
        <PeopleTab tenant={tenant} today={today} people={people} word={word} credentialWord={credentialWord} busyOutside={busy} onReload={load}
          onOpenShift={setOpenShift} onSignedOut={onSignedOut} list={staff} openId={openPerson} setOpenId={setOpenPerson} />
      ) : tab === 'projects' && projects.length > 0 ? (
        <ProjectsTab tenant={tenant} projects={projects} openId={openProject} setOpenId={setOpenProject} word={word} equipmentWord={equipmentWord}
          projectWord={projectWord} busyOutside={busy} onReload={load} onOpenShift={setOpenShift} onRoster={rosterAt} onSignedOut={onSignedOut} />
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
                  {kindLabel(i.kind, equipmentWord)} · {i.startsIn}
                </Text>
                <Text style={styles.cardTitle}>{i.title}</Text>
                {!!i.detail && <Text>{i.detail}</Text>}
                <Text style={[styles.muted, styles.small]}>{shiftWhere(i.shift, today)}</Text>
                <Text style={[styles.link, styles.small]}>Open ›</Text>
              </Pressable>
            ))}
            {attention.truncated && <Text style={[styles.muted, styles.small]}>The list was cut short; the {rosterWord.lower} on the web has the rest.</Text>}
          </>
        )}

        {tab === 'requests' && (
          <>
            {can.leave && <Text style={styles.section}>Leave waiting for a decision</Text>}
            {!can.leave ? null : leave.length === 0 ? <Text style={styles.muted}>None waiting.</Text> : leave.map(l => (
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

            <Text style={styles.section}>{rosterWord.one} changes waiting for approval</Text>
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
                {r.canWithdraw && (
                  <Pressable disabled={busy} onPress={() => confirm('Withdraw this request?', () => act(`/change-requests/${r.id}/withdraw`, () => 'Withdrawn.'))}>
                    <Text style={[styles.link, styles.small, { marginTop: 6 }]}>Withdraw</Text>
                  </Pressable>
                )}
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
