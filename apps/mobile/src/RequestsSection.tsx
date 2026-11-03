import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Text, TextInput } from './ui';
import { api, ApiError, SignedOut } from './api';
import { addDays, dayLabel } from './format';
import {
  kindLabel, needsTime, REQUEST_KINDS, REQUEST_STATUS, requestBody, requestProblem, stepTime, type MyDayRequest, type RequestKind,
} from './day-requests';
import { styles } from './styles';

function Step({ label, onBack, onNext, backDisabled }: { label: string; onBack: () => void; onNext: () => void; backDisabled?: boolean }) {
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

/**
 * Requests for a day (David, 3 Nov, answer 3): ask the office for something on a date, e.g. an AM shift or to finish
 * by 14:00. The office marks each done or not possible; the person can withdraw one while it waits.
 */
export function RequestsSection({ tenant, today, word, onSignedOut }: { tenant: string; today: string; word: { lower: string }; onSignedOut: () => void }) {
  const [list, setList] = useState<MyDayRequest[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [date, setDate] = useState(addDays(today, 1));
  const [kind, setKind] = useState<RequestKind>('prefer_am');
  const [time, setTime] = useState('14:00');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setList((await api<{ requests: MyDayRequest[] }>('/my/day-requests', { tenant })).requests);
    } catch (e) {
      if (e instanceof SignedOut) onSignedOut();
    }
  }, [tenant, onSignedOut]);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    const problem = requestProblem(kind, note);
    if (problem) { Alert.alert('Not sent', problem); return; }
    setBusy(true);
    try {
      await api('/my/day-requests', { method: 'POST', tenant, body: requestBody(date, kind, time, note) });
      Alert.alert('Request sent', 'The office will see it on the roster.');
      setAsking(false); setNote('');
      await load();
    } catch (e) {
      if (e instanceof SignedOut) onSignedOut();
      else Alert.alert('Not sent', e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = (r: MyDayRequest) => Alert.alert('Withdraw this request?', `${dayLabel(r.date, today)}: ${r.line}`, [
    { text: 'Keep it', style: 'cancel' },
    {
      text: 'Withdraw', style: 'destructive', onPress: async () => {
        try { await api(`/my/day-requests/${r.id}/withdraw`, { method: 'POST', tenant }); await load(); } catch (e) {
          if (e instanceof SignedOut) onSignedOut();
          else Alert.alert('Not withdrawn', e instanceof Error ? e.message : 'Something went wrong');
        }
      },
    },
  ]);

  return (
    <>
      <Text style={styles.section}>Requests for a day</Text>
      <Text style={[styles.muted, styles.small, { marginBottom: 8 }]}>Ask for something on a particular day, such as an AM {word.lower} or to finish by a time. The office tries to fit it in.</Text>
      {list && list.length === 0 && !asking && <Text style={styles.muted}>No requests.</Text>}
      {list?.map(r => (
        <View key={r.id} style={styles.card}>
          <Text style={{ fontWeight: '600' }}>{dayLabel(r.date, today)}</Text>
          <Text>{r.line}</Text>
          <Text style={[styles.muted, styles.small]}>{REQUEST_STATUS[r.status]}{r.decidedNote ? `: ${r.decidedNote}` : ''}</Text>
          {r.status === 'open' && (
            <Pressable onPress={() => withdraw(r)} style={{ marginTop: 8 }}><Text style={styles.link}>Withdraw request</Text></Pressable>
          )}
        </View>
      ))}
      {asking ? (
        <View style={styles.card}>
          <Text style={styles.label}>Day</Text>
          <Step label={dayLabel(date, today)} backDisabled={date <= today} onBack={() => setDate(addDays(date, -1))} onNext={() => setDate(addDays(date, 1))} />
          <Text style={styles.label}>What would you like?</Text>
          <View style={styles.chips}>
            {REQUEST_KINDS.map(k => (
              <Pressable key={k} style={[styles.chip, kind === k && styles.chipOn]} onPress={() => setKind(k)}
                accessibilityRole="radio" accessibilityState={{ selected: kind === k }}>
                <Text style={[styles.chipText, kind === k && styles.chipTextOn]}>{kindLabel(k, word)}</Text>
              </Pressable>
            ))}
          </View>
          {needsTime(kind) && (<>
            <Text style={styles.label}>{kind === 'finish_by' ? 'Finish by' : 'Start after'}</Text>
            <Step label={time} onBack={() => setTime(stepTime(time, -1))} onNext={() => setTime(stepTime(time, 1))} />
          </>)}
          <Text style={styles.label}>{kind === 'other' ? 'What you would like' : 'Note (optional)'}</Text>
          <TextInput style={styles.input} value={note} onChangeText={setNote} maxLength={200} multiline
            placeholder="Please don't include health details" />
          <View style={styles.row}>
            <Pressable style={[styles.button, styles.grow]} disabled={busy} onPress={send}><Text style={styles.buttonText}>Send request</Text></Pressable>
            <Pressable style={[styles.button, styles.secondary, styles.grow]} onPress={() => setAsking(false)}>
              <Text style={[styles.buttonText, styles.secondaryText]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable style={[styles.button, styles.secondary]} onPress={() => { setAsking(true); setDate(addDays(today, 1)); }}>
          <Text style={[styles.buttonText, styles.secondaryText]}>Ask for something on a day</Text>
        </Pressable>
      )}
    </>
  );
}
