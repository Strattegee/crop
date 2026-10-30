import * as AuthSession from 'expo-auth-session';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, ApiError, SignedOut } from './src/api';
import { finishSignIn, loadSession, signOut } from './src/auth';
import { AUTH_CLIENT_ID, AUTH_ISSUER, REDIRECT_URI, SCOPES } from './src/config';
import { businessesOf, byDay, dayLabel, offerCloses, roleLine, STATE_LABEL, timeRange, type MyOffer, type MyShift } from './src/format';

// Closes the sign-in browser window when it returns to the app.
WebBrowser.maybeCompleteAuthSession();

type Me = { email: string; memberships: { tenantSlug: string; tenantName: string; role: string }[] };
type My = { business: string; firstName: string; today: string; word: { one: string; many: string; lower: string; lowerMany: string } };
type Phase = 'loading' | 'signedOut' | 'choose' | 'ready';

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [tenant, setTenant] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const discovery = AuthSession.useAutoDiscovery(AUTH_ISSUER);
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    { clientId: AUTH_CLIENT_ID, redirectUri: REDIRECT_URI, scopes: SCOPES, usePKCE: true },
    discovery,
  );

  const start = useCallback(async () => {
    setError(null);
    try {
      const m = await api<Me>('/me');
      setMe(m);
      const list = businessesOf(m);
      if (list.length === 1) {
        setTenant(list[0].slug);
        setPhase('ready');
      } else setPhase('choose');
    } catch (e) {
      if (e instanceof SignedOut) setPhase('signedOut');
      else {
        setError(e instanceof Error ? e.message : 'Something went wrong');
        setPhase('signedOut');
      }
    }
  }, []);

  useEffect(() => {
    loadSession().then(s => (s ? start() : setPhase('signedOut')));
  }, [start]);

  useEffect(() => {
    if (response?.type !== 'success' || !request?.codeVerifier || !discovery) {
      if (response?.type === 'error') setError(response.error?.message ?? 'Sign-in did not finish');
      return;
    }
    setPhase('loading');
    finishSignIn(response.params.code, request.codeVerifier, REDIRECT_URI, discovery)
      .then(start)
      .catch(() => {
        setError('Sign-in did not finish. Please try again.');
        setPhase('signedOut');
      });
  }, [response, request, discovery, start]);

  const out = async () => {
    await signOut();
    setMe(null);
    setTenant(null);
    setPhase('signedOut');
  };

  return (
    <SafeAreaView style={styles.page}>
      <StatusBar style="dark" />
      {phase === 'loading' && <ActivityIndicator style={{ marginTop: 80 }} />}
      {phase === 'signedOut' && (
        <View style={styles.centre}>
          <Text style={styles.title}>CROP</Text>
          <Text style={styles.muted}>Your shifts and offers</Text>
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable style={[styles.button, !request && styles.disabled]} disabled={!request} onPress={() => promptAsync()}>
            <Text style={styles.buttonText}>Sign in</Text>
          </Pressable>
          <Text style={[styles.muted, styles.small]}>Use the email address your employer has for you.</Text>
        </View>
      )}
      {phase === 'choose' && me && (
        <ScrollView contentContainerStyle={styles.list}>
          <Text style={styles.heading}>Choose a business</Text>
          {businessesOf(me).map(b => (
            <Pressable key={b.slug} style={styles.card} onPress={() => { setTenant(b.slug); setPhase('ready'); }}>
              <Text style={styles.cardTitle}>{b.name}</Text>
            </Pressable>
          ))}
          <SignOutLink onPress={out} />
        </ScrollView>
      )}
      {phase === 'ready' && tenant && me && (
        <Home tenant={tenant} switchable={me.memberships.length > 1} onSwitch={() => setPhase('choose')} onSignOut={out} onSignedOut={() => setPhase('signedOut')} />
      )}
    </SafeAreaView>
  );
}

function Home({ tenant, switchable, onSwitch, onSignOut, onSignedOut }: {
  tenant: string; switchable: boolean; onSwitch: () => void; onSignOut: () => void; onSignedOut: () => void;
}) {
  const [tab, setTab] = useState<'shifts' | 'offers'>('shifts');
  const [my, setMy] = useState<My | null>(null);
  const [shifts, setShifts] = useState<MyShift[]>([]);
  const [offers, setOffers] = useState<MyOffer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [m, s, o] = await Promise.all([
        api<My>('/my', { tenant }),
        api<{ shifts: MyShift[] }>('/my/shifts', { tenant }),
        api<{ offers: MyOffer[] }>('/my/offers', { tenant }),
      ]);
      setMy(m);
      setShifts(s.shifts);
      setOffers(o.offers);
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

  const reply = async (offer: MyOffer, answer: 'accept' | 'decline') => {
    setBusy(true);
    try {
      await api(`/my/offers/${offer.id}/${answer}`, { method: 'POST', tenant });
      Alert.alert(answer === 'accept' ? "You're booked" : 'Thanks for letting us know', answer === 'accept' ? offer.shift.label : undefined);
    } catch (e) {
      if (e instanceof SignedOut) return onSignedOut();
      Alert.alert('Not done', e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');
    }
    await load();
  };

  const word = my?.word ?? { one: 'Shift', many: 'Shifts', lower: 'shift', lowerMany: 'shifts' };
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>{my ? `Hi ${my.firstName}` : ' '}</Text>
          <Text style={styles.muted}>{my?.business ?? ''}</Text>
        </View>
        {switchable && <Pressable onPress={onSwitch}><Text style={styles.link}>Switch</Text></Pressable>}
      </View>
      <View style={styles.tabs}>
        {(['shifts', 'offers'] as const).map(t => (
          <Pressable key={t} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
            <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>
              {t === 'shifts' ? `My ${word.lowerMany}` : `Offers${offers.length ? ` (${offers.length})` : ''}`}
            </Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />}>
        {error && <Text style={styles.error}>{error}</Text>}
        {tab === 'shifts' && !error && (shifts.length === 0
          ? <Text style={styles.muted}>No {word.lowerMany} in the next four weeks yet. New ones show here once the roster is published.</Text>
          : byDay(shifts).map(d => (
            <View key={d.date}>
              <Text style={styles.day}>{dayLabel(d.date, my?.today)}</Text>
              {d.shifts.map(s => (
                <View key={s.id} style={styles.card}>
                  <Text style={styles.cardTitle}>{timeRange(s)}</Text>
                  <Text>{roleLine(s)}</Text>
                  <Text style={styles.muted}>{s.site}</Text>
                  {s.duties.length > 0 && <Text style={[styles.muted, styles.small]}>Duties: {s.duties.join(', ')}</Text>}
                  <Text style={[styles.badge, s.state === 'booked' ? styles.badgeBooked : styles.badgeWaiting]}>{STATE_LABEL[s.state]}</Text>
                </View>
              ))}
            </View>
          )))}
        {tab === 'offers' && !error && (offers.length === 0
          ? <Text style={styles.muted}>No offers right now.</Text>
          : offers.map(o => (
            <View key={o.id} style={styles.card}>
              <Text style={styles.day}>{dayLabel(o.shift.date, my?.today)}</Text>
              <Text style={styles.cardTitle}>{timeRange(o.shift)}</Text>
              <Text>{roleLine(o.shift)}</Text>
              <Text style={styles.muted}>{o.shift.site}</Text>
              {offerCloses(o.expiresAt) && <Text style={[styles.muted, styles.small]}>{offerCloses(o.expiresAt)} · first to accept gets it</Text>}
              <View style={styles.row}>
                <Pressable style={[styles.button, styles.grow]} disabled={busy} onPress={() => reply(o, 'accept')}>
                  <Text style={styles.buttonText}>Accept</Text>
                </Pressable>
                <Pressable style={[styles.button, styles.secondary, styles.grow]} disabled={busy} onPress={() => reply(o, 'decline')}>
                  <Text style={[styles.buttonText, styles.secondaryText]}>Decline</Text>
                </Pressable>
              </View>
            </View>
          )))}
        <SignOutLink onPress={onSignOut} />
      </ScrollView>
    </View>
  );
}

function SignOutLink({ onPress }: { onPress: () => void }) {
  return <Pressable onPress={onPress} style={{ marginTop: 24, alignSelf: 'center' }}><Text style={styles.link}>Sign out</Text></Pressable>;
}

const NAVY = '#1f3a5f';
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f6f7f9' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 32, fontWeight: '700', color: NAVY },
  heading: { fontSize: 20, fontWeight: '700', color: NAVY },
  muted: { color: '#5d6775' },
  small: { fontSize: 13, marginTop: 4 },
  error: { color: '#b42318', marginVertical: 12 },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 8 },
  tabs: { flexDirection: 'row', marginHorizontal: 16, borderRadius: 8, backgroundColor: '#e6e9ee', padding: 3 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  tabOn: { backgroundColor: '#fff' },
  tabText: { color: '#5d6775', fontWeight: '600' },
  tabTextOn: { color: NAVY },
  list: { padding: 16, paddingBottom: 48 },
  day: { fontWeight: '700', marginTop: 12, marginBottom: 6, color: NAVY },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e1e4e8' },
  cardTitle: { fontSize: 17, fontWeight: '600', marginBottom: 2 },
  badge: { alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden', fontSize: 13 },
  badgeBooked: { backgroundColor: '#d3f0dc', color: '#11592b' },
  badgeWaiting: { backgroundColor: '#fbefc4', color: '#6b5300' },
  row: { flexDirection: 'row', gap: 10, marginTop: 12 },
  grow: { flex: 1 },
  button: { backgroundColor: NAVY, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, alignItems: 'center', marginTop: 16, minHeight: 44 },
  secondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: NAVY },
  secondaryText: { color: NAVY },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  link: { color: NAVY, textDecorationLine: 'underline', fontWeight: '600' },
});
