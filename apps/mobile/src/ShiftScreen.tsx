import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { api, ApiError, SignedOut } from './api';
import {
  actionsFor, assignable, assignedMessage, assignQuestion, candidateMeta, candidateState, confirmLabel, mondayOf, offerable, offeredMessage,
  pendingOffers, phoneLinks, REQUEST_SENT, requestKind, shiftWhen, stageOf,
  type Action, type Candidate, type FillState,
} from './shift';
import { styles } from './styles';

type Word = { one: string; lower: string };

/**
 * One shift in manager mode (backlog item 9a): who is on it, and filling it from the phone. Put on a ready person,
 * offer it to bank and casual staff, confirm, take off, record a pull-out, cancel, call or text the person.
 * All through the office endpoints, so eligibility and the after-publishing rule apply as on the web; when that rule
 * stops this person making a change, each button asks an owner or admin instead (a change request).
 */
export function ShiftScreen({ tenant, shiftId, today, word, onBack, onSignedOut }: {
  tenant: string; shiftId: string; today?: string; word: Word; onBack: () => void; onSignedOut: () => void;
}) {
  const [state, setState] = useState<FillState | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback((e: unknown) => {
    if (e instanceof SignedOut) onSignedOut();
    else setError(e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');
  }, [onSignedOut]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await api<FillState>(`/shifts/${shiftId}/bank-fill?everyone=true`, { tenant });
      setState(s);
      setPicked(new Set());
      const weeks = await api<{ facilityId: string; changeRefusal?: string | null }[]>(
        `/roster/weeks?weekStart=${mondayOf(s.shift.localDate)}&facilityId=${s.shift.facilityId}`, { tenant }).catch(() => []);
      setRefusal(weeks.find(w => w.facilityId === s.shift.facilityId)?.changeRefusal ?? null);
      // Agency people have no contacts in this business; for our own people, their phone for Call and Text.
      if (s.shift.workerId && !s.shift.agencyName) {
        const w = await api<{ phone: string | null }>(`/workers/${s.shift.workerId}`, { tenant }).catch(() => null);
        setPhone(w?.phone ?? null);
      } else setPhone(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }, [shiftId, tenant, fail]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (path: string, body: unknown, done: (r: unknown) => string) => {
    setBusy(true);
    try {
      const r = await api(path, { method: 'POST', tenant, body });
      Alert.alert('Done', done(r));
    } catch (e) {
      if (e instanceof SignedOut) return onSignedOut();
      Alert.alert('Not done', e instanceof Error ? e.message : 'Something went wrong');
    }
    await load();
  };

  /** Does the change, or (when the after-publishing rule stops this person) asks an owner or admin for it. */
  const change = (action: Action, path: string, body: Record<string, unknown>, done: (r: unknown) => string) => {
    const kind = requestKind(action);
    if (refusal && kind) {
      const reasonText = typeof body.reason === 'string' ? body.reason : undefined;
      return run(`/shifts/${shiftId}/change-requests`, { change: kind, workerId: body.workerId, reason: reasonText }, () => REQUEST_SENT);
    }
    return run(path, body, done);
  };

  const ask = (title: string, message: string | undefined, yes: string, go: () => void) =>
    Alert.alert(title, message, [{ text: 'Not now', style: 'cancel' }, { text: yes, onPress: go }]);

  if (!state) {
    return (
      <View style={{ flex: 1 }}>
        <Back onBack={onBack} />
        <ScrollView contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />}>
          {error ? <Text style={styles.error}>{error}</Text> : <Text style={styles.muted}>Loading…</Text>}
        </ScrollView>
      </View>
    );
  }

  const s = state.shift;
  const stage = stageOf(s);
  const actions = actionsFor(s, !!refusal);
  const can = (a: Action) => actions.includes(a);
  const toOffer = offerable(state.candidates);
  const people = assignable(state.candidates);
  const shown = showAll ? state.candidates : people.slice(0, 8);
  const waiting = pendingOffers(state.offers);
  const links = phoneLinks(phone);

  const putOn = (c: Candidate) => {
    const q = assignQuestion(c, word);
    ask(refusal ? `Ask to put ${c.name} on?` : q.title, q.message, refusal ? 'Ask' : 'Put on', () =>
      change('assign', `/shifts/${shiftId}/assign`, { workerId: c.workerId }, r => assignedMessage(c.name, (r as { warnings?: string[] }).warnings)));
  };

  const offer = () => {
    const ids = [...picked];
    ask(`Offer this ${word.lower} to ${ids.length} ${ids.length === 1 ? 'person' : 'people'}?`, 'They are sent an email and a text with a link to accept. The first to accept gets it.', 'Send offer', () =>
      run(`/shifts/${shiftId}/offers`, { workerIds: ids }, r => offeredMessage(r as { offered: number; alreadyOffered: number; messages: number })));
  };

  const toggle = (id: string) => setPicked(p => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  return (
    <View style={{ flex: 1 }}>
      <Back onBack={onBack} />
      <ScrollView contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />}>
        {error && <Text style={styles.error}>{error}</Text>}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{s.areaName ? `${s.role} · ${s.areaName}` : s.role}</Text>
          <Text>{shiftWhen(s, today)}</Text>
          <Text style={styles.muted}>{s.facilityName}</Text>
          {!!s.coveringName && <Text style={[styles.muted, styles.small]}>Covering {s.coveringName}</Text>}
          {!!s.notes && <Text style={[styles.muted, styles.small]}>{s.notes}</Text>}
          <Text style={[styles.badge, stage.tone === 'urgent' ? styles.badgeUrgent : stage.tone === 'booked' ? styles.badgeBooked : styles.badgeWaiting]}>{stage.label}</Text>
        </View>

        {!!refusal && actions.length > 0 && (
          <Text style={[styles.muted, styles.small, { marginBottom: 8 }]}>{refusal} Changes you make here go to an owner or admin to approve.</Text>
        )}

        {s.workerId && (
          <>
            {links && (
              <View style={[styles.row, { marginTop: 0 }]}>
                <Pressable style={[styles.button, styles.secondary, styles.grow, { marginTop: 0 }]} onPress={() => Linking.openURL(links.call)} accessibilityLabel={`Call ${s.workerName}`}>
                  <Text style={[styles.buttonText, styles.secondaryText]}>Call</Text>
                </Pressable>
                <Pressable style={[styles.button, styles.secondary, styles.grow, { marginTop: 0 }]} onPress={() => Linking.openURL(links.text)} accessibilityLabel={`Text ${s.workerName}`}>
                  <Text style={[styles.buttonText, styles.secondaryText]}>Text</Text>
                </Pressable>
              </View>
            )}
            {can('confirm') && (
              <Pressable style={styles.button} disabled={busy} onPress={() => ask(refusal ? 'Ask an owner or admin to confirm them?' : `${confirmLabel(s)}?`, undefined, 'Yes', () =>
                change('confirm', `/shifts/${shiftId}/confirm`, {}, () => `Booked: ${s.workerName}.`))}>
                <Text style={styles.buttonText}>{refusal ? 'Ask to confirm' : confirmLabel(s)}</Text>
              </Pressable>
            )}
            {can('remove') && (
              <View style={styles.row}>
                <Pressable style={[styles.button, styles.secondary, styles.grow, { marginTop: 0 }]} disabled={busy}
                  onPress={() => ask(`${refusal ? 'Ask to take' : 'Take'} ${s.workerName} off?`, `The ${word.lower} goes back to having nobody on it.`, 'Take off', () =>
                    change('remove', `/shifts/${shiftId}/unassign`, {}, () => `${s.workerName} is off it. It now needs someone.`))}>
                  <Text style={[styles.buttonText, styles.secondaryText]}>Take off</Text>
                </Pressable>
                <Pressable style={[styles.button, styles.secondary, styles.grow, { marginTop: 0 }]} disabled={busy}
                  onPress={() => ask(`Record that ${s.workerName} pulled out?`, `Use this when they told you they can't work it. The ${word.lower} then needs someone.`, 'They pulled out', () =>
                    change('pulled_out', `/shifts/${shiftId}/unassign`, { pulledOut: true }, () => `Recorded. It now needs someone.`))}>
                  <Text style={[styles.buttonText, styles.secondaryText]}>Pulled out</Text>
                </Pressable>
              </View>
            )}
          </>
        )}

        {can('offer') && (
          <>
            <Text style={styles.section}>Offer to bank and casual staff</Text>
            {waiting.length > 0 && (
              <View style={styles.card}>
                <Text>Waiting for a reply: {waiting.map(o => o.workerName).join(', ')}</Text>
                <Pressable disabled={busy} onPress={() => ask('Withdraw the offers waiting?', 'Nobody can accept them after this.', 'Withdraw', () =>
                  run(`/shifts/${shiftId}/offers/withdraw`, {}, () => 'Offers withdrawn.'))}>
                  <Text style={[styles.link, { marginTop: 8 }]}>Withdraw offers</Text>
                </Pressable>
              </View>
            )}
            {toOffer.length === 0 ? <Text style={styles.muted}>No bank or casual staff can take it right now.</Text> : (
              <>
                <View style={styles.chips}>
                  {toOffer.map(c => (
                    <Pressable key={c.workerId} style={[styles.chip, picked.has(c.workerId) && styles.chipOn]} onPress={() => toggle(c.workerId)}
                      accessibilityRole="checkbox" accessibilityState={{ checked: picked.has(c.workerId) }}>
                      <Text style={[styles.chipText, picked.has(c.workerId) && styles.chipTextOn]}>{c.name}{c.warnings.length ? ' (!)' : ''}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable style={[styles.button, picked.size === 0 && styles.disabled]} disabled={busy || picked.size === 0} onPress={offer}>
                  <Text style={styles.buttonText}>{picked.size ? `Send offer to ${picked.size}` : 'Choose who to offer it to'}</Text>
                </Pressable>
              </>
            )}
          </>
        )}

        {can('assign') && (
          <>
            <Text style={styles.section}>Put someone on</Text>
            {shown.length === 0 && <Text style={styles.muted}>Nobody can work it as things stand.</Text>}
            {shown.map(c => {
              const st = candidateState(c);
              return (
                <View key={c.workerId} style={styles.card}>
                  <Text style={styles.cardTitle}>{c.name}</Text>
                  <Text style={[styles.muted, styles.small]}>{candidateMeta(c)}{c.offer?.status === 'pending' ? ' · offer waiting' : ''}</Text>
                  <Text style={[styles.small, st.tone === 'blocked' ? styles.error : st.tone === 'warning' ? { color: '#6b5300' } : { color: '#11592b' }, { marginVertical: 4 }]}>{st.label}</Text>
                  {c.eligible && (
                    <Pressable style={[styles.button, styles.secondary, { marginTop: 6 }]} disabled={busy} onPress={() => putOn(c)}>
                      <Text style={[styles.buttonText, styles.secondaryText]}>{refusal ? 'Ask to put on' : 'Put on'}</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
            {(people.length > shown.length || state.candidates.length > people.length) && (
              <Pressable onPress={() => setShowAll(v => !v)}>
                <Text style={styles.link}>{showAll ? 'Show only people who can work it' : `Show everyone, with why they can't (${state.candidates.length})`}</Text>
              </Pressable>
            )}
          </>
        )}

        {can('cancel') && (
          <View style={{ marginTop: 28 }}>
            {!cancelling ? (
              <Pressable onPress={() => setCancelling(true)}><Text style={[styles.link, { color: '#b42318' }]}>{refusal ? `Ask to cancel this ${word.lower}` : `Cancel this ${word.lower}`}</Text></Pressable>
            ) : (
              <View style={styles.card}>
                <Text style={styles.label}>Why is it cancelled?</Text>
                <TextInput style={styles.input} value={reason} onChangeText={setReason} maxLength={300} placeholder="For example, the client no longer needs it" />
                <View style={styles.row}>
                  <Pressable style={[styles.button, styles.grow, { marginTop: 0, backgroundColor: '#b42318' }, !reason.trim() && styles.disabled]} disabled={busy || !reason.trim()}
                    onPress={() => ask(refusal ? `Ask to cancel this ${word.lower}?` : `Cancel this ${word.lower}?`, s.workerName ? `${s.workerName} comes off it.` : undefined, 'Yes', () =>
                      change('cancel', `/shifts/${shiftId}/cancel`, { reason: reason.trim() }, () => 'Cancelled.'))}>
                    <Text style={styles.buttonText}>{refusal ? 'Ask' : 'Cancel it'}</Text>
                  </Pressable>
                  <Pressable style={[styles.button, styles.secondary, styles.grow, { marginTop: 0 }]} onPress={() => setCancelling(false)}>
                    <Text style={[styles.buttonText, styles.secondaryText]}>Keep it</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Back({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={styles.link}>‹ Back</Text>
      </Pressable>
    </View>
  );
}
