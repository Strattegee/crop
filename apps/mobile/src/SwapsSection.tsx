import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { api, ApiError, SignedOut } from './api';
import { styles } from './styles';
import { afterYesLine, askedMessage, mySwapLine, SWAP_BADGE, swapOrder, whenLine, type MySwap, type SwapMode, type SwapOptions } from './swaps';

type Word = { one: string; lower: string; lowerMany: string };
const badgeStyle = { booked: styles.badgeBooked, waiting: styles.badgeWaiting, urgent: styles.badgeUrgent };

/** Swaps waiting for the person's answer, their own open asks, and recent outcomes (My shifts tab). */
export function SwapsList({ tenant, swaps, today, onChanged, onSignedOut }: {
  tenant: string; swaps: MySwap[]; today?: string; onChanged: () => void; onSignedOut: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!swaps.length) return null;
  const act = async (s: MySwap, what: 'accept' | 'decline' | 'withdraw') => {
    setBusy(true);
    try {
      const r = await api<MySwap>(`/my/swaps/${s.id}/${what}`, { method: 'POST', tenant });
      Alert.alert(r.stateLine);
    } catch (e) {
      if (e instanceof SignedOut) return onSignedOut();
      Alert.alert('Not done', e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
    onChanged();
  };
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Swaps</Text>
      {swapOrder(swaps).map(s => (
        <View key={s.id} style={{ marginTop: 10 }}>
          <Text>{mySwapLine(s, today)}</Text>
          <Text style={[styles.badge, badgeStyle[SWAP_BADGE[s.status]]]}>{s.stateLine}</Text>
          {s.canAnswer && (
            <View style={styles.row}>
              <Pressable style={[styles.button, styles.grow]} disabled={busy} onPress={() => act(s, 'accept')}>
                <Text style={styles.buttonText}>Yes</Text>
              </Pressable>
              <Pressable style={[styles.button, styles.secondary, styles.grow]} disabled={busy} onPress={() => act(s, 'decline')}>
                <Text style={[styles.buttonText, styles.secondaryText]}>No</Text>
              </Pressable>
            </View>
          )}
          {s.canWithdraw && (
            <Pressable disabled={busy} onPress={() => act(s, 'withdraw')} style={{ marginTop: 6 }}>
              <Text style={styles.link}>Take it back</Text>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}

/** Under one of the person's shifts: who could take it, or whose shift they could swap it for. */
export function SwapPicker({ tenant, shiftId, mode, word, today, onDone, onClose, onSignedOut }: {
  tenant: string; shiftId: string; mode: SwapMode; word: Word; today?: string;
  onDone: () => void; onClose: () => void; onSignedOut: () => void;
}) {
  const [options, setOptions] = useState<SwapOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<SwapOptions>(`/my/swaps/options?shiftId=${shiftId}`, { tenant })
      .then(setOptions)
      .catch(e => (e instanceof SignedOut ? onSignedOut() : setError(e instanceof Error ? e.message : 'Something went wrong')));
  }, [tenant, shiftId, onSignedOut]);

  const ask = async (workerId: string, name: string, otherShiftId?: string) => {
    setBusy(true);
    try {
      await api('/my/swaps', { method: 'POST', tenant, body: { shiftId, workerId, ...(otherShiftId ? { otherShiftId } : {}) } });
      Alert.alert('Asked', askedMessage(name, mode, word.lower));
      onDone();
    } catch (e) {
      if (e instanceof SignedOut) return onSignedOut();
      Alert.alert('Not asked', e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: '#e3e6ee', paddingTop: 10 }}>
      {error && <Text style={styles.error}>{error}</Text>}
      {!options && !error && <ActivityIndicator />}
      {options && (
        <>
          <Text style={{ fontWeight: '600' }}>Ask someone to take it</Text>
          {options.takers.length === 0
            ? <Text style={[styles.muted, styles.small]}>Nobody with the app can work this {word.lower} right now.</Text>
            : options.takers.map(t => (
              <Pressable key={t.workerId} disabled={busy} onPress={() => ask(t.workerId, t.name)} style={{ marginTop: 6 }}>
                <Text style={styles.link}>{t.name}</Text>
              </Pressable>
            ))}
          <Text style={{ fontWeight: '600', marginTop: 12 }}>Or swap it for one of theirs</Text>
          {options.swaps.length === 0
            ? <Text style={[styles.muted, styles.small]}>No {word.lowerMany} at this site to swap for in the next four weeks.</Text>
            : options.swaps.map(o => (
              <Pressable key={o.shiftId} disabled={busy} onPress={() => ask(o.workerId, o.name, o.shiftId)} style={{ marginTop: 6 }}>
                <Text style={styles.link}>{o.name}: {whenLine(o.shift, today)}</Text>
              </Pressable>
            ))}
          <Text style={[styles.muted, styles.small, { marginTop: 10 }]}>{afterYesLine(options.mode)}</Text>
        </>
      )}
      <Pressable onPress={onClose} style={{ marginTop: 8 }}><Text style={styles.link}>Close</Text></Pressable>
    </View>
  );
}
