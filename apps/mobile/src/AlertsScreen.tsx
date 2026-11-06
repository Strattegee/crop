import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import { Text } from './ui';
import { api, ApiError, SignedOut } from './api';
import { phonesNote, QUIET_CHOICES, quietChoice, quietNote, type AlertSettings } from './alerts';
import { styles } from './styles';

type Word = { one: string; many: string; lower: string; lowerMany: string };

/**
 * Phone alerts (backlog item 9a, 6 Nov): what this office person wants on their phone and their quiet hours, from
 * `GET/PUT /alerts`. Shifts at risk (starting within two hours with nobody on them or not confirmed, an agency
 * pulling its person out) for everyone in the office; decisions waiting (leave from the app, roster changes) for
 * owners and admins. Only their own choices.
 */
export function AlertsScreen({ tenant, word, rosterWord, onBack, onSignedOut }: {
  tenant: string; word: Word; rosterWord: Word; onBack: () => void; onSignedOut: () => void;
}) {
  const [s, setS] = useState<AlertSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (body?: Partial<AlertSettings>) => {
    setBusy(true);
    setError(null);
    try {
      setS(await api<AlertSettings>('/alerts', body ? { method: 'PUT', tenant, body } : { tenant }));
    } catch (e) {
      if (e instanceof SignedOut) return onSignedOut();
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }, [tenant, onSignedOut]);

  useEffect(() => {
    run();
  }, [run]);

  const chosen = s ? quietChoice(s) : null;
  const phones = s ? phonesNote(s.phones) : null;

  return (
    <ScrollView contentContainerStyle={styles.list}>
      <Pressable onPress={onBack} accessibilityRole="button"><Text style={styles.link}>‹ Back</Text></Pressable>
      <Text style={[styles.heading, { marginTop: 8 }]}>Phone alerts</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      {!s ? null : (
        <>
          {phones && <Text style={[styles.muted, styles.small]}>{phones}</Text>}
          <View style={styles.card}>
            <View style={[styles.row, { alignItems: 'center' }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{word.many} at risk</Text>
                <Text style={[styles.muted, styles.small]}>
                  At your sites: starting within 2 hours with nobody on them or not confirmed, and an agency pulling its person out.
                </Text>
              </View>
              <Switch value={s.atRisk} disabled={busy} onValueChange={v => run({ atRisk: v })} accessibilityLabel={`${word.many} at risk`} />
            </View>
          </View>
          {s.decides && (
            <View style={styles.card}>
              <View style={[styles.row, { alignItems: 'center' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>Decisions waiting</Text>
                  <Text style={[styles.muted, styles.small]}>Leave asked for in the app, and {rosterWord.lower} changes to approve.</Text>
                </View>
                <Switch value={s.decisions} disabled={busy} onValueChange={v => run({ decisions: v })} accessibilityLabel="Decisions waiting" />
              </View>
            </View>
          )}
          <Text style={styles.section}>Quiet hours</Text>
          <View style={styles.chips}>
            {QUIET_CHOICES.map(c => (
              <Pressable key={c.key} style={[styles.chip, chosen === c.key && styles.chipOn]} disabled={busy}
                onPress={() => run({ quietFrom: c.from, quietUntil: c.until })} accessibilityRole="button" accessibilityState={{ selected: chosen === c.key }}>
                <Text style={[styles.chipText, chosen === c.key && styles.chipTextOn]}>{c.label}</Text>
              </Pressable>
            ))}
          </View>
          {!chosen && <Text style={[styles.muted, styles.small]}>{s.quietLine}</Text>}
          <Text style={[styles.muted, styles.small]}>{quietNote(s, word.lowerMany)}</Text>
        </>
      )}
    </ScrollView>
  );
}
