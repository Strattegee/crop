import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text, TextInput } from './ui';
import { api, ApiError, SignedOut } from './api';
import {
  addressBody, addressInput, CHANGE_STATUS, doneMessage, EMPTY_ADDRESS, fieldBody, fieldProblem, fieldValue, saveLabel, startValue, waitingFor,
  type AddressInput, type MyAddress, type MyDetails, type MyField,
} from './details';
import { styles } from './styles';

const GENDERS: { value: string; label: string }[] = [{ value: 'F', label: 'Female' }, { value: 'M', label: 'Male' }, { value: '', label: 'Not saying' }];

/**
 * My details (David, 3 Nov 2026, answer 5): the person's own details as their business lets them see them. Each one
 * they may change opens a small form; changes the business wants to check go to the office and wait (shown below,
 * with Withdraw). Never the date of birth or anything the office keeps to itself.
 */
export function DetailsScreen({ tenant, onBack, onSignedOut, footer }: { tenant: string; onBack: () => void; onSignedOut: () => void; footer?: React.ReactNode }) {
  const [d, setD] = useState<MyDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [input, setInput] = useState({ value: '', firstName: '', lastName: '' });
  const [addr, setAddr] = useState<AddressInput>(EMPTY_ADDRESS);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setD(await api<MyDetails>('/my/details', { tenant }));
      setError(null);
    } catch (e) {
      if (e instanceof SignedOut) onSignedOut();
      else setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }, [tenant, onSignedOut]);
  useEffect(() => { load(); }, [load]);

  const send = async (body: unknown, needsApproval: boolean) => {
    setBusy(true);
    try {
      const r = await api<{ outcome: 'changed' | 'requested'; details: MyDetails }>('/my/details', { method: 'POST', tenant, body });
      setD(r.details);
      setEditing(null);
      const m = doneMessage(r.outcome);
      if (needsApproval || r.outcome === 'requested') Alert.alert(m.title, m.body);
    } catch (e) {
      if (e instanceof SignedOut) onSignedOut();
      else Alert.alert('Not saved', e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const saveField = (f: MyField) => {
    const problem = fieldProblem(f.field, input);
    if (problem) { Alert.alert('Not saved', problem); return; }
    void send(fieldBody(f.field, input), f.needsApproval);
  };

  const confirmAddress = (a: MyAddress, action: 'current' | 'remove', needsApproval: boolean) => Alert.alert(
    action === 'current' ? 'Make this your current address?' : 'Take this address off your list?', a.line, [
      { text: 'Cancel', style: 'cancel' },
      { text: needsApproval ? 'Send to the office' : action === 'current' ? 'Make current' : 'Take off', onPress: () => send({ field: 'address', action, addressId: a.id }, needsApproval) },
    ]);

  const withdraw = (id: string) => Alert.alert('Withdraw this change?', undefined, [
    { text: 'Keep it', style: 'cancel' },
    {
      text: 'Withdraw', style: 'destructive', onPress: async () => {
        try { setD(await api<MyDetails>(`/my/detail-changes/${id}/withdraw`, { method: 'POST', tenant })); } catch (e) {
          if (e instanceof SignedOut) onSignedOut();
          else Alert.alert('Not withdrawn', e instanceof Error ? e.message : 'Something went wrong');
        }
      },
    },
  ]);

  const addressForm = (needsApproval: boolean, id?: string) => (
    <View style={styles.card}>
      {([['line1', 'Street address'], ['line2', 'Second line (optional)'], ['suburb', 'Suburb or town'], ['state', 'State or region'], ['postcode', 'Postcode'], ['label', 'Name, e.g. Home (optional)']] as const).map(([k, label]) => (
        <View key={k}>
          <Text style={styles.label}>{label}</Text>
          <TextInput style={styles.input} value={addr[k]} onChangeText={v => setAddr({ ...addr, [k]: v })} autoCapitalize={k === 'state' ? 'characters' : 'words'}
            keyboardType={k === 'postcode' ? 'number-pad' : 'default'} maxLength={k === 'postcode' ? 10 : 200} />
        </View>
      ))}
      <View style={styles.row}>
        <Pressable style={[styles.button, styles.grow, busy && styles.disabled]} disabled={busy} onPress={() => {
          if (!addr.line1.trim()) { Alert.alert('Not saved', 'Enter the street address'); return; }
          void send(addressBody(addr, id), needsApproval);
        }}><Text style={styles.buttonText}>{saveLabel(needsApproval)}</Text></Pressable>
        <Pressable style={[styles.button, styles.secondary, styles.grow]} onPress={() => setEditing(null)}>
          <Text style={[styles.buttonText, styles.secondaryText]}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );

  const country = d?.country ?? 'AU';
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />}>
      <Pressable onPress={onBack} style={{ marginBottom: 8 }}><Text style={styles.link}>‹ Back</Text></Pressable>
      <Text style={styles.section}>My details</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      {d?.fields.map(f => (
        <View key={f.field} style={styles.card}>
          <Text style={[styles.muted, styles.small]}>{f.label}</Text>
          <Text style={{ fontWeight: '600' }}>{fieldValue(f, country)}</Text>
          {editing === f.field ? (<>
            {f.field === 'name' ? (<>
              <Text style={styles.label}>First name</Text>
              <TextInput style={styles.input} value={input.firstName} onChangeText={v => setInput({ ...input, firstName: v })} maxLength={100} />
              <Text style={styles.label}>Last name</Text>
              <TextInput style={styles.input} value={input.lastName} onChangeText={v => setInput({ ...input, lastName: v })} maxLength={100} />
            </>) : f.field === 'gender' ? (
              <View style={[styles.chips, { marginTop: 8 }]}>
                {GENDERS.map(g => (
                  <Pressable key={g.value} style={[styles.chip, input.value === g.value && styles.chipOn]} onPress={() => setInput({ ...input, value: g.value })}
                    accessibilityRole="radio" accessibilityState={{ selected: input.value === g.value }}>
                    <Text style={[styles.chipText, input.value === g.value && styles.chipTextOn]}>{g.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <TextInput style={[styles.input, { marginTop: 8 }]} value={input.value} onChangeText={v => setInput({ ...input, value: v })}
                keyboardType={f.field === 'mobile' ? 'phone-pad' : f.field === 'email' ? 'email-address' : 'default'}
                autoCapitalize={f.field === 'email' ? 'none' : 'words'} maxLength={f.field === 'email' ? 200 : 100} />
            )}
            {f.needsApproval && <Text style={[styles.muted, styles.small]}>The office checks this change before it’s made.</Text>}
            <View style={styles.row}>
              <Pressable style={[styles.button, styles.grow, busy && styles.disabled]} disabled={busy} onPress={() => saveField(f)}>
                <Text style={styles.buttonText}>{saveLabel(f.needsApproval)}</Text>
              </Pressable>
              <Pressable style={[styles.button, styles.secondary, styles.grow]} onPress={() => setEditing(null)}>
                <Text style={[styles.buttonText, styles.secondaryText]}>Cancel</Text>
              </Pressable>
            </View>
          </>) : f.canChange && !waitingFor(d.changes, f.field) && (
            <Pressable style={{ marginTop: 8 }} onPress={() => { setEditing(f.field); setInput(startValue(f, country)); }}>
              <Text style={styles.link}>Change</Text>
            </Pressable>
          )}
          {waitingFor(d.changes, f.field) && <Text style={[styles.muted, styles.small]}>A change is waiting for the office.</Text>}
        </View>
      ))}
      {d?.addresses && (<>
        <Text style={styles.section}>Addresses</Text>
        {d.addresses.list.length === 0 && editing !== 'address:new' && <Text style={styles.muted}>No address recorded.</Text>}
        {d.addresses.list.map(a => (
          <View key={a.id}>
            <View style={styles.card}>
              <Text style={[styles.muted, styles.small]}>{[a.label, a.current ? 'Current' : null].filter(Boolean).join(' · ') || 'Address'}</Text>
              <Text style={{ fontWeight: '600' }}>{a.line}</Text>
              {d.addresses!.canChange && editing !== `address:${a.id}` && !waitingFor(d.changes, 'address', a.id) && (
                <View style={[styles.row, { flexWrap: 'wrap' }]}>
                  <Pressable onPress={() => { setEditing(`address:${a.id}`); setAddr(addressInput(a)); }}><Text style={styles.link}>Correct</Text></Pressable>
                  {!a.current && <Pressable onPress={() => confirmAddress(a, 'current', d.addresses!.needsApproval)}><Text style={styles.link}>Make current</Text></Pressable>}
                  <Pressable onPress={() => confirmAddress(a, 'remove', d.addresses!.needsApproval)}><Text style={styles.link}>Take off</Text></Pressable>
                </View>
              )}
            </View>
            {editing === `address:${a.id}` && addressForm(d.addresses!.needsApproval, a.id)}
          </View>
        ))}
        {d.addresses.canChange && !waitingFor(d.changes, 'address') && (editing === 'address:new' ? addressForm(d.addresses.needsApproval) : (
          <Pressable style={[styles.button, styles.secondary]} onPress={() => { setEditing('address:new'); setAddr(EMPTY_ADDRESS); }}>
            <Text style={[styles.buttonText, styles.secondaryText]}>Add an address</Text>
          </Pressable>
        ))}
        <Text style={[styles.muted, styles.small]}>Earlier addresses are kept on file by the office.</Text>
      </>)}
      {d && d.changes.length > 0 && (<>
        <Text style={styles.section}>Changes you asked for</Text>
        {d.changes.map(c => (
          <View key={c.id} style={styles.card}>
            <Text style={{ fontWeight: '600' }}>{c.what}</Text>
            <Text>{c.field === 'mobile' ? fieldValue({ field: 'mobile', label: '', value: c.line, raw: null, canChange: false, needsApproval: false }, country) : c.line}</Text>
            <Text style={[styles.muted, styles.small]}>{CHANGE_STATUS[c.status]}{c.note ? `: ${c.note}` : ''}</Text>
            {c.canWithdraw && <Pressable onPress={() => withdraw(c.id)} style={{ marginTop: 8 }}><Text style={styles.link}>Withdraw</Text></Pressable>}
          </View>
        ))}
      </>)}
      <Text style={[styles.muted, styles.small, { marginTop: 12 }]}>Anything else that needs changing? Ask the office.</Text>
      {footer}
    </ScrollView>
  );
}
