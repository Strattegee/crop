import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from './ui';
import { api, ApiError, SignedOut } from './api';
import {
  addressLine, equipmentLine, memberLine, projectAlerts, projectCounts, projectDayLine, projectLine, projectOrder, stockLine, teamShown,
  type ProjectDetail, type ProjectRow,
} from './projects';
import { shiftLine, type RosterShift } from './roster';
import { stageOf } from './shift';
import { styles } from './styles';

type Word = { one: string; many: string; lower: string; lowerMany: string };

const TONE = { urgent: styles.badgeUrgent, waiting: styles.badgeWaiting, booked: styles.badgeBooked, plain: null } as const;

/**
 * Projects in manager mode (per-site access "still to do", 6 Nov): the projects this person can see (a supervisor
 * only their own sites, through the database's rules), each opening an overview: today and tomorrow, the
 * {shifts} today (each opens the shift screen), the team, the equipment on it and low stock. Read only; "Open the
 * roster here" goes to the Roster tab at that project. Same endpoints as the web's Projects pages.
 */
export function ProjectsTab({ tenant, projects, openId, setOpenId, word, equipmentWord, projectWord, busyOutside, onReload, onOpenShift, onRoster, onSignedOut }: {
  tenant: string; projects: ProjectRow[]; openId: string | null; setOpenId: (id: string | null) => void;
  word: Word; equipmentWord: Word; projectWord: Word; busyOutside: boolean; onReload: () => void;
  onOpenShift: (shiftId: string) => void; onRoster: (facilityId: string, today: string) => void; onSignedOut: () => void;
}) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [today, setToday] = useState<RosterShift[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!openId) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api<ProjectDetail>(`/projects/${openId}`, { tenant });
      const s = await api<RosterShift[]>(`/shifts?from=${d.today}&to=${d.today}&facilityId=${openId}`, { tenant });
      setDetail(d);
      setToday(s.filter(x => x.status !== 'cancelled'));
    } catch (e) {
      if (e instanceof SignedOut) onSignedOut();
      else setError(e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }, [tenant, openId, onSignedOut]);

  useEffect(() => {
    setDetail(null);
    setToday([]);
    load();
  }, [load]);

  if (!openId) {
    return (
      <ScrollView contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={busyOutside} onRefresh={onReload} />}>
        {projects.length === 0 && <Text style={styles.muted}>No {projectWord.lowerMany} to show.</Text>}
        {projectOrder(projects).map(p => (
          <Pressable key={p.id} style={[styles.card, p.unfilledNext7 > 0 && styles.urgent]} onPress={() => setOpenId(p.id)}
            accessibilityRole="button" accessibilityHint={`Opens the ${projectWord.lower}`}>
            <Text style={styles.cardTitle}>{p.name}{p.code ? ` (${p.code})` : ''}</Text>
            {!!projectLine(p) && <Text style={[styles.muted, styles.small]}>{projectLine(p)}</Text>}
            <Text style={styles.small}>{projectCounts(p, word)}</Text>
            <Text style={[styles.link, styles.small]}>Open ›</Text>
          </Pressable>
        ))}
      </ScrollView>
    );
  }

  const d = detail;
  const team = d ? teamShown(d.team) : { current: [], upcoming: [] };
  const equipment = d ? d.equipment.filter(e => e.state !== 'ended') : [];
  const low = d ? d.stock.filter(s => s.low) : [];
  const alerts = d ? projectAlerts(d, word, equipmentWord) : [];

  return (
    <ScrollView contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />}>
      <Pressable onPress={() => setOpenId(null)} accessibilityRole="button"><Text style={styles.link}>‹ All {projectWord.lowerMany}</Text></Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
      {d && (
        <>
          <Text style={[styles.heading, { marginTop: 8 }]}>{d.name}{d.code ? ` (${d.code})` : ''}</Text>
          {!!projectLine({ clientName: d.clientName, statusLabel: d.statusLabel ?? '', dates: d.dates }) &&
            <Text style={styles.muted}>{projectLine({ clientName: d.clientName, statusLabel: d.statusLabel ?? '', dates: d.dates })}</Text>}
          {!!addressLine(d) && <Text style={[styles.muted, styles.small]}>{addressLine(d)}</Text>}
          {!!d.supervisorName && <Text style={styles.small}>Supervisor on site: {d.supervisorName}</Text>}
          {!!d.managerName && <Text style={styles.small}>Manager: {d.managerName}</Text>}
          {alerts.map(a => <Text key={a} style={[styles.badge, styles.badgeUrgent]}>{a}</Text>)}

          <Text style={styles.section}>Today and tomorrow</Text>
          {d.days.map(day => <Text key={day.day}>{projectDayLine(day, d.today, word)}</Text>)}
          <Pressable style={[styles.button, { marginTop: 10 }]} onPress={() => onRoster(d.id, d.today)} accessibilityRole="button">
            <Text style={styles.buttonText}>Open the roster here</Text>
          </Pressable>

          {today.length > 0 && <Text style={styles.section}>{word.many} today</Text>}
          {today.map(s => {
            const stage = stageOf(s, equipmentWord);
            const who = s.equipmentOnly ? `${equipmentWord.one} only` : s.workerName ? (s.agencyName ? `${s.workerName} (${s.agencyName})` : s.workerName) : 'Unfilled';
            return (
              <Pressable key={s.id} style={[styles.card, stage.tone === 'urgent' && styles.urgent]} onPress={() => onOpenShift(s.id)}
                accessibilityRole="button" accessibilityHint={`Opens the ${word.lower} to fill or change it`}>
                <Text style={[styles.muted, styles.small, { marginTop: 0 }]}>{shiftLine(s)}</Text>
                <Text style={styles.cardTitle}>{who}</Text>
                <Text style={[styles.badge, TONE[stage.tone]]}>{stage.label}</Text>
              </Pressable>
            );
          })}

          <Text style={styles.section}>Team</Text>
          {team.current.length === 0 && team.upcoming.length === 0 && <Text style={styles.muted}>Nobody on the team yet.</Text>}
          {team.current.map(m => (
            <View key={m.id} style={styles.card}>
              <Text style={styles.cardTitle}>{m.name}</Text>
              {!!memberLine(m) && <Text style={[styles.muted, styles.small]}>{memberLine(m)}</Text>}
            </View>
          ))}
          {team.upcoming.length > 0 && <Text style={[styles.muted, styles.small]}>Joining later</Text>}
          {team.upcoming.map(m => (
            <View key={m.id} style={styles.card}>
              <Text style={styles.cardTitle}>{m.name}</Text>
              {!!memberLine(m) && <Text style={[styles.muted, styles.small]}>{memberLine(m)}</Text>}
            </View>
          ))}

          <Text style={styles.section}>{equipmentWord.one}</Text>
          {equipment.length === 0 && <Text style={styles.muted}>No {equipmentWord.lower} on this {projectWord.lower}.</Text>}
          {equipment.map(e => {
            const l = equipmentLine(e);
            return (
              <View key={e.id} style={[styles.card, !!l.problem && styles.urgent]}>
                <Text style={styles.cardTitle}>{e.equipmentName}</Text>
                <Text style={[styles.muted, styles.small]}>{l.line}</Text>
                {!!l.problem && <Text style={[styles.badge, styles.badgeUrgent]}>{l.problem}</Text>}
              </View>
            );
          })}

          {d.stock.length > 0 && (
            <>
              <Text style={styles.section}>Stock</Text>
              {low.length === 0 ? <Text style={styles.muted}>Nothing low on stock.</Text> : low.map(s => (
                <View key={s.itemId} style={styles.card}>
                  <Text style={styles.cardTitle}>{s.name}</Text>
                  <Text style={[styles.muted, styles.small]}>{stockLine(s)}</Text>
                </View>
              ))}
            </>
          )}
          <Text style={[styles.muted, styles.small, { marginTop: 16 }]}>Changes to the team, {equipmentWord.lower} and stages are made on the web.</Text>
        </>
      )}
    </ScrollView>
  );
}
