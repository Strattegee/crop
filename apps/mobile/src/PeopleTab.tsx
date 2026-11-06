import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text, TextInput } from './ui';
import { api, ApiError, SignedOut } from './api';
import { addDays, dayLabel } from './format';
import {
  credentialLine, filterLabel, hoursLine, issueLine, issuesInOrder, nextExpiryLine, PEOPLE_FILTERS, peopleShown, personLine, personName, READY,
  type PeopleFilter, type PersonDetail, type PersonRow,
} from './people';
import { shiftLine, type RosterShift } from './roster';
import { phoneLinks, stageOf } from './shift';
import { styles } from './styles';

type Word = { one: string; many: string; lower: string; lowerMany: string };

const TONE = { urgent: styles.badgeUrgent, waiting: styles.badgeWaiting, booked: styles.badgeBooked, plain: null } as const;

/** How far ahead a person's shifts are listed. */
const SHIFT_DAYS = 14;

/**
 * People in manager mode (per-site access "still to do", 6 Nov): who the person running the roster can see (a
 * supervisor only the people on their sites, through the API), not ready to work first, with a search box and
 * Not ready / Expiring chips. Opening someone shows whether they're ready to work and what's missing, their
 * credentials, their hours this week and their shifts in the next two weeks (each opens the shift screen); office
 * roles also get Call and Text. Read only: changes to a person's record are made on the web.
 */
export function PeopleTab({ tenant, today, people, word, credentialWord, busyOutside, onReload, onOpenShift, onSignedOut, list, openId, setOpenId }: {
  tenant: string; today: string | undefined; people: Word; word: Word; credentialWord: Word; busyOutside: boolean; onReload: () => void;
  onOpenShift: (shiftId: string) => void; onSignedOut: () => void; list: PersonRow[]; openId: string | null; setOpenId: (id: string | null) => void;
}) {
  const [filter, setFilter] = useState<PeopleFilter>('all');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<PersonDetail | null>(null);
  const [shifts, setShifts] = useState<RosterShift[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!openId) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api<PersonDetail>(`/workers/${openId}`, { tenant });
      const from = today ?? d.today;
      const s = await api<RosterShift[]>(`/shifts?workerId=${openId}&from=${from}&to=${addDays(from, SHIFT_DAYS - 1)}`, { tenant });
      setDetail(d);
      setShifts(s.filter(x => x.status !== 'cancelled'));
    } catch (e) {
      if (e instanceof SignedOut) onSignedOut();
      else setError(e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }, [tenant, openId, today, onSignedOut]);

  useEffect(() => {
    setDetail(null);
    setShifts([]);
    load();
  }, [load]);

  if (!openId) {
    const shown = peopleShown(list, filter, search);
    return (
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={busyOutside} onRefresh={onReload} />}>
        <TextInput style={styles.input} value={search} onChangeText={setSearch} placeholder="Search by name or role" autoCorrect={false}
          accessibilityLabel={`Search ${people.lowerMany}`} clearButtonMode="while-editing" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, { marginTop: 10, marginBottom: 6 }]}>
          {PEOPLE_FILTERS.map(f => {
            const on = filter === f;
            return (
              <Pressable key={f} style={[styles.chip, on && styles.chipOn]} onPress={() => setFilter(f)} accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{filterLabel(f, list)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {list.length === 0 && <Text style={styles.muted}>No {people.lowerMany} to show.</Text>}
        {list.length > 0 && shown.length === 0 && <Text style={styles.muted}>Nobody matches.</Text>}
        {shown.map(p => {
          const ready = READY[p.compliance];
          const hours = hoursLine(p.card);
          const expiry = today ? nextExpiryLine(p.card?.nextExpiry, today) : null;
          return (
            <Pressable key={p.id} style={[styles.card, p.compliance === 'non_compliant' && styles.urgent]} onPress={() => setOpenId(p.id)}
              accessibilityRole="button" accessibilityHint={`Opens ${personName(p)}`}>
              <Text style={styles.cardTitle}>{personName(p)}</Text>
              {!!personLine(p) && <Text style={[styles.muted, styles.small]}>{personLine(p)}</Text>}
              <Text style={[styles.badge, TONE[ready.tone]]}>{ready.label}{p.issueCount ? ` · ${p.issueCount} to fix` : ''}</Text>
              {!!hours && <Text style={styles.small}>{hours}</Text>}
              {!!p.card?.nextShift && <Text style={[styles.muted, styles.small]}>Next: {p.card.nextShift.label}</Text>}
              {!!expiry && expiry.soon && <Text style={[styles.small, styles.kpiBad]}>{expiry.text}</Text>}
            </Pressable>
          );
        })}
      </ScrollView>
    );
  }

  const d = detail;
  const links = d ? phoneLinks(d.phone) : null;
  const ready = d ? READY[d.compliance] : null;
  const expiry = d ? nextExpiryLine(d.card?.nextExpiry, d.today) : null;

  return (
    <ScrollView contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />}>
      <Pressable onPress={() => setOpenId(null)} accessibilityRole="button"><Text style={styles.link}>‹ All {people.lowerMany}</Text></Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
      {d && ready && (
        <>
          <Text style={[styles.heading, { marginTop: 8 }]}>{personName(d)}</Text>
          {!!personLine(d) && <Text style={styles.muted}>{personLine(d)}</Text>}
          <Text style={[styles.badge, TONE[ready.tone]]}>{ready.label}</Text>
          {!!hoursLine(d.card) && <Text style={[styles.small, { marginTop: 6 }]}>{hoursLine(d.card)}</Text>}
          {!!expiry && <Text style={[styles.small, expiry.soon ? styles.kpiBad : styles.muted]}>{expiry.text}</Text>}
          {links && (
            <View style={styles.row}>
              <Pressable style={[styles.button, styles.secondary, styles.grow]} onPress={() => Linking.openURL(links.call)} accessibilityLabel={`Call ${personName(d)}`}>
                <Text style={[styles.buttonText, styles.secondaryText]}>Call</Text>
              </Pressable>
              <Pressable style={[styles.button, styles.secondary, styles.grow]} onPress={() => Linking.openURL(links.text)} accessibilityLabel={`Text ${personName(d)}`}>
                <Text style={[styles.buttonText, styles.secondaryText]}>Text</Text>
              </Pressable>
            </View>
          )}

          {d.issues.length > 0 && <Text style={styles.section}>To fix</Text>}
          {issuesInOrder(d.issues).map(i => (
            <Text key={`${i.credentialTypeId}-${i.forDuty ?? ''}`} style={[styles.small, i.severity === 'hard' && i.problem !== 'expiring' ? styles.kpiBad : styles.muted]}>
              {i.severity === 'hard' ? 'Must have' : 'Should have'} · {issueLine(i)}
            </Text>
          ))}

          <Text style={styles.section}>{word.many} in the next {SHIFT_DAYS} days</Text>
          {shifts.length === 0 && <Text style={styles.muted}>None.</Text>}
          {shifts.map(s => {
            const stage = stageOf(s);
            return (
              <Pressable key={s.id} style={styles.card} onPress={() => onOpenShift(s.id)}
                accessibilityRole="button" accessibilityHint={`Opens the ${word.lower}`}>
                <Text style={[styles.muted, styles.small, { marginTop: 0 }]}>{dayLabel(s.localDate, d.today)} · {s.facilityName}</Text>
                <Text style={styles.cardTitle}>{shiftLine(s)}</Text>
                <Text style={[styles.badge, TONE[stage.tone]]}>{stage.label}</Text>
              </Pressable>
            );
          })}

          <Text style={styles.section}>{credentialWord.many}</Text>
          {d.credentials.length === 0 && <Text style={styles.muted}>None recorded.</Text>}
          {d.credentials.map(c => (
            <View key={c.id} style={[styles.card, (c.status === 'expired' || c.verification === 'rejected') && styles.urgent]}>
              <Text style={styles.cardTitle}>{c.typeName}</Text>
              <Text style={[styles.muted, styles.small]}>{credentialLine(c)}</Text>
            </View>
          ))}
          <Text style={[styles.muted, styles.small, { marginTop: 16 }]}>Changes to a {people.lower}'s record are made on the web.</Text>
        </>
      )}
    </ScrollView>
  );
}
