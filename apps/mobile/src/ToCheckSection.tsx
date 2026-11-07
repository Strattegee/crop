import { useState } from 'react';
import { Alert, Linking, Pressable, View } from 'react-native';
import { api, ApiError, SignedOut } from './api';
import { styles } from './styles';
import { Text, TextInput } from './ui';
import { checkedMessage, decidePath, fileLabel, fileLinkPath, reasonProblem, toCheckTitle, type ToCheckItem } from './to-check';

/**
 * "To check" on the manager side's Requests tab (backlog item 9a, 7 Nov): credentials and right to work proof waiting
 * for the office. Files open in the phone's browser through the 5-minute links; owners and admins check or don't
 * accept (with a reason), others see the list.
 */
export function ToCheckSection({ tenant, items, canDecide, heading, onChanged, onSignedOut }: {
  tenant: string;
  items: ToCheckItem[];
  canDecide: boolean;
  heading: string;
  onChanged: () => void;
  onSignedOut: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const fail = (e: unknown) => {
    if (e instanceof SignedOut) return onSignedOut();
    Alert.alert('Not done', e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');
  };

  const open = async (i: ToCheckItem, fileId: string) => {
    setBusy(true);
    try {
      const r = await api<{ url: string }>(fileLinkPath(i, fileId), { tenant });
      await Linking.openURL(r.url);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (i: ToCheckItem, answer: 'verify' | 'reject') => {
    if (answer === 'reject') {
      const problem = reasonProblem(reason);
      if (problem) return Alert.alert('Not done', problem);
    }
    setBusy(true);
    try {
      await api(decidePath(i, answer), { method: 'POST', tenant, body: answer === 'reject' ? { reason: reason.trim() } : {} });
      Alert.alert('Done', checkedMessage(answer, i.title));
      setRejecting(null);
      setReason('');
      onChanged();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  if (!items.length) return null;
  return (
    <>
      <Text style={styles.section}>{heading}</Text>
      {items.map(i => (
        <View key={`${i.kind}:${i.id}`} style={styles.card}>
          <Text style={styles.cardTitle}>{toCheckTitle(i)}</Text>
          {i.lines.map(l => <Text key={l} style={[styles.muted, styles.small]}>{l}</Text>)}
          {i.files.map(f => (
            <Pressable key={f.id} disabled={busy} onPress={() => open(i, f.id)} accessibilityLabel={`Open ${f.filename}`}>
              <Text style={[styles.link, styles.small, { marginTop: 6 }]}>Open {fileLabel(f)}</Text>
            </Pressable>
          ))}
          {!canDecide ? <Text style={[styles.muted, styles.small]}>An owner or admin checks it.</Text>
            : rejecting === `${i.kind}:${i.id}` ? (
              <>
                <TextInput style={[styles.input, { marginTop: 8 }]} value={reason} onChangeText={setReason} maxLength={500}
                  placeholder="Why isn’t it accepted? (they see this)" accessibilityLabel="Reason" />
                <View style={styles.row}>
                  <Pressable style={[styles.button, styles.grow]} disabled={busy} onPress={() => decide(i, 'reject')}>
                    <Text style={styles.buttonText}>Don’t accept</Text>
                  </Pressable>
                  <Pressable style={[styles.button, styles.secondary, styles.grow]} disabled={busy} onPress={() => { setRejecting(null); setReason(''); }}>
                    <Text style={[styles.buttonText, styles.secondaryText]}>Back</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <View style={styles.row}>
                <Pressable style={[styles.button, styles.grow]} disabled={busy}
                  onPress={() => Alert.alert(`Mark ${i.title} as checked?`, 'Only once you have looked at the proof.', [
                    { text: 'Not now', style: 'cancel' }, { text: 'Checked', onPress: () => decide(i, 'verify') }])}>
                  <Text style={styles.buttonText}>Checked</Text>
                </Pressable>
                <Pressable style={[styles.button, styles.secondary, styles.grow]} disabled={busy} onPress={() => { setRejecting(`${i.kind}:${i.id}`); setReason(''); }}>
                  <Text style={[styles.buttonText, styles.secondaryText]}>Not accepted</Text>
                </Pressable>
              </View>
            )}
        </View>
      ))}
    </>
  );
}
