import * as AuthSession from 'expo-auth-session';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, SafeAreaView, ScrollView, Text, View } from 'react-native';
import { api, ApiError, SignedOut } from './src/api';
import { finishSignIn, loadSession, signOut } from './src/auth';
import { AUTH_CLIENT_ID, AUTH_ISSUER, REDIRECT_URI, SCOPES } from './src/config';
import { AvailabilityTab } from './src/AvailabilityTab';
import { CredentialsTab } from './src/CredentialsTab';
import { ManagerHome } from './src/ManagerHome';
import { roleOf, startMode, type Mode } from './src/manager';
import { styles } from './src/styles';
import { businessesOf, byDay, dayLabel, offerCloses, roleLine, STATE_LABEL, timeRange, type MyOffer, type MyShift } from './src/format';

// Closes the sign-in browser window when it returns to the app.
WebBrowser.maybeCompleteAuthSession();

type Me = { email: string; memberships: { tenantSlug: string; tenantName: string; role: string }[] };
type Word = { one: string; many: string; lower: string; lowerMany: string };
type My = { business: string; firstName: string; today: string; word: Word; credentialWord?: Word };
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
        <Ready key={tenant} tenant={tenant} me={me} onSwitch={() => setPhase('choose')} onSignOut={out} onSignedOut={() => setPhase('signedOut')} />
      )}
    </SafeAreaView>
  );
}

/**
 * One app for everyone (David, 29 Oct): owners, admins and allocators open in manager mode; workers see their own
 * shifts. A manager who is also rostered (their sign-in is linked to a person in the business) can switch between the two.
 */
function Ready({ tenant, me, onSwitch, onSignOut, onSignedOut }: {
  tenant: string; me: Me; onSwitch: () => void; onSignOut: () => void; onSignedOut: () => void;
}) {
  const role = roleOf(me, tenant);
  const [mode, setMode] = useState<Mode>(startMode(role));
  const [linked, setLinked] = useState(false);
  const switchable = me.memberships.length > 1;
  const business = me.memberships.find(m => m.tenantSlug === tenant)?.tenantName ?? '';

  useEffect(() => {
    if (mode !== 'manager') return;
    // Is this manager also a rostered person here? Only then offer their own shifts.
    api('/my', { tenant }).then(() => setLinked(true), () => setLinked(false));
  }, [tenant, mode]);

  if (mode === 'manager' && role) {
    return <ManagerHome tenant={tenant} business={business} role={role} onMyShifts={linked ? () => setMode('worker') : null}
      switchable={switchable} onSwitch={onSwitch} onSignOut={onSignOut} onSignedOut={onSignedOut} />;
  }
  return <Home tenant={tenant} switchable={switchable} onSwitch={onSwitch} onSignOut={onSignOut} onSignedOut={onSignedOut}
    onManager={startMode(role) === 'manager' ? () => setMode('manager') : null} />;
}

function Home({ tenant, switchable, onSwitch, onSignOut, onSignedOut, onManager }: {
  tenant: string; switchable: boolean; onSwitch: () => void; onSignOut: () => void; onSignedOut: () => void; onManager: (() => void) | null;
}) {
  const [tab, setTab] = useState<'shifts' | 'offers' | 'availability' | 'credentials'>('shifts');
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
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          {onManager && <Pressable onPress={onManager}><Text style={styles.link}>Run the roster</Text></Pressable>}
          {switchable && <Pressable onPress={onSwitch}><Text style={styles.link}>Switch</Text></Pressable>}
        </View>
      </View>
      <View style={styles.tabs}>
        {(['shifts', 'offers', 'availability', 'credentials'] as const).map(t => (
          <Pressable key={t} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
            <Text style={[styles.tabText, tab === t && styles.tabTextOn]} numberOfLines={1} adjustsFontSizeToFit>
              {t === 'shifts' ? `My ${word.lowerMany}` : t === 'offers' ? `Offers${offers.length ? ` (${offers.length})` : ''}` : t === 'availability' ? 'Availability' : (my?.credentialWord?.many ?? 'Credentials')}
            </Text>
          </Pressable>
        ))}
      </View>
      {tab === 'availability' ? (
        <AvailabilityTab tenant={tenant} word={word} onSignedOut={onSignedOut} footer={<SignOutLink onPress={onSignOut} />} />
      ) : tab === 'credentials' ? (
        <CredentialsTab tenant={tenant} word={my?.credentialWord ?? { one: 'Credential', many: 'Credentials', lower: 'credential', lowerMany: 'credentials' }} onSignedOut={onSignedOut} footer={<SignOutLink onPress={onSignOut} />} />
      ) : (
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
      )}
    </View>
  );
}

function SignOutLink({ onPress }: { onPress: () => void }) {
  return <Pressable onPress={onPress} style={{ marginTop: 24, alignSelf: 'center' }}><Text style={styles.link}>Sign out</Text></Pressable>;
}
