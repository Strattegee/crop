import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { api, ApiError, SignedOut, upload } from './api';
import {
  CHECK_LABEL, dateFromParts, expiryLine, filesLine, LEVEL_LABEL, uploadName,
  type CredentialType, type MyCredential, type MyNeed,
} from './format';
import { styles } from './styles';

type Data = { today: string; credentials: MyCredential[]; needs: MyNeed[]; types: CredentialType[] };
type Parts = { d: string; m: string; y: string };
const NO_DATE: Parts = { d: '', m: '', y: '' };

/** Day / Month / Year boxes, so nobody has to guess which order a date goes in. */
function DateBoxes({ value, onChange, label }: { value: Parts; onChange: (p: Parts) => void; label: string }) {
  const box = (key: keyof Parts, placeholder: string, width: number, max: number) => (
    <TextInput style={[styles.input, { width }]} value={value[key]} onChangeText={v => onChange({ ...value, [key]: v.replace(/\D/g, '') })}
      placeholder={placeholder} keyboardType="number-pad" maxLength={max} accessibilityLabel={`${label}: ${placeholder}`} />
  );
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {box('d', 'Day', 64, 2)}{box('m', 'Month', 72, 2)}{box('y', 'Year', 88, 4)}
    </View>
  );
}

/** The worker app's Credentials tab: what their role needs, their credentials, adding one and adding photos or files. */
export function CredentialsTab({ tenant, word, onSignedOut, footer }: {
  tenant: string; word: { one: string; many: string; lower: string; lowerMany: string }; onSignedOut: () => void; footer: ReactNode;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Adding a credential.
  const [adding, setAdding] = useState(false);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [number, setNumber] = useState('');
  const [issuedBy, setIssuedBy] = useState('');
  const [issued, setIssued] = useState<Parts>(NO_DATE);
  const [expiry, setExpiry] = useState<Parts>(NO_DATE);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await api<Data>('/my/credentials', { tenant }));
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

  const fail = (title: string, e: unknown) => {
    if (e instanceof SignedOut) onSignedOut();
    else Alert.alert(title, e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');
  };

  const startAdding = (id: string | null) => {
    setTypeId(id);
    setNumber('');
    setIssuedBy('');
    setIssued(NO_DATE);
    setExpiry(NO_DATE);
    setAdding(true);
  };

  const type = data?.types.find(t => t.id === typeId) ?? null;
  const save = async () => {
    if (!type) return Alert.alert(`Choose which ${word.lower}`);
    const issueDate = dateFromParts(issued.d, issued.m, issued.y);
    const expiryDate = dateFromParts(expiry.d, expiry.m, expiry.y);
    if (issueDate === null) return Alert.alert('Check the issue date', 'Enter the day, month and year, e.g. 3, 11, 2026');
    if (expiryDate === null) return Alert.alert('Check the expiry date', 'Enter the day, month and year, e.g. 3, 11, 2028');
    setBusy(true);
    try {
      await api('/my/credentials', {
        method: 'POST', tenant,
        body: { credentialTypeId: type.id, number: number.trim() || null, issuedBy: issuedBy.trim() || null, issueDate: issueDate || null, expiryDate: expiryDate || null },
      });
      setAdding(false);
      Alert.alert('Added', `Now add a photo or file of your ${type.name} so the office can check it.`);
    } catch (e) {
      fail('Not added', e);
    }
    await load();
  };

  const send = async (c: MyCredential, file: { uri: string; name: string; type: string }) => {
    setBusy(true);
    try {
      await upload(`/my/credentials/${c.id}/documents`, file, { tenant });
      Alert.alert('File added', 'The office will check it.');
    } catch (e) {
      fail('Not added', e);
    }
    await load();
  };

  const takePhoto = async (c: MyCredential) => {
    const allowed = await ImagePicker.requestCameraPermissionsAsync();
    if (!allowed.granted) return Alert.alert('Camera not allowed', 'Allow CROP to use the camera in your phone settings, or choose a file instead.');
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    await send(c, { uri: a.uri, name: uploadName(a.fileName, a.mimeType ?? 'image/jpeg'), type: a.mimeType ?? 'image/jpeg' });
  };

  const chooseFile = async (c: MyCredential) => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png', 'image/heic'], copyToCacheDirectory: true });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    if (a.size && a.size > 10 * 1024 * 1024) return Alert.alert('That file is too big', 'Files can be up to 10 MB.');
    await send(c, { uri: a.uri, name: uploadName(a.name, a.mimeType), type: a.mimeType ?? 'application/octet-stream' });
  };

  return (
    <ScrollView contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />}>
      {error && <Text style={styles.error}>{error}</Text>}
      {data && (
        <>
          <Text style={[styles.section, { marginTop: 0 }]}>What you need</Text>
          {data.needs.length === 0
            ? <Text style={styles.muted}>Nothing right now. You have everything your role needs.</Text>
            : data.needs.map(n => (
              <View key={n.credentialTypeId} style={[styles.card, { flexDirection: 'row', alignItems: 'center' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '600' }}>{n.line}</Text>
                  <Text style={[styles.muted, styles.small]}>{n.must ? 'Needed before you can work' : 'Recommended'}</Text>
                </View>
                {n.canAdd && !adding && <Pressable onPress={() => startAdding(n.credentialTypeId)}><Text style={styles.link}>Add</Text></Pressable>}
              </View>
            ))}

          <Text style={styles.section}>My {word.lowerMany}</Text>
          {data.credentials.length === 0 && <Text style={styles.muted}>None yet.</Text>}
          {data.credentials.map(c => (
            <View key={c.id} style={styles.card}>
              <Text style={styles.cardTitle}>{c.typeName}</Text>
              {c.number && <Text style={styles.muted}>{c.number}</Text>}
              {c.issuedBy && <Text style={styles.muted}>Issued by {c.issuedBy}</Text>}
              <Text style={c.status === 'valid' ? styles.muted : styles.error}>{expiryLine(c)}</Text>
              {filesLine(c) && <Text style={[styles.muted, styles.small]}>{filesLine(c)}</Text>}
              <Text style={[styles.badge, c.check === 'checked' ? styles.badgeBooked : styles.badgeWaiting]}>{CHECK_LABEL[c.check]}</Text>
              {c.canAddFiles && (
                <View style={styles.row}>
                  <Pressable style={[styles.button, styles.secondary, styles.grow, { marginTop: 0 }]} disabled={busy} onPress={() => takePhoto(c)}>
                    <Text style={[styles.buttonText, styles.secondaryText]}>Take a photo</Text>
                  </Pressable>
                  <Pressable style={[styles.button, styles.secondary, styles.grow, { marginTop: 0 }]} disabled={busy} onPress={() => chooseFile(c)}>
                    <Text style={[styles.buttonText, styles.secondaryText]}>Choose a file</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}

          {adding ? (
            <View style={styles.card}>
              <Text style={styles.label}>Which {word.lower}</Text>
              <View style={styles.chips}>
                {data.types.map(t => (
                  <Pressable key={t.id} style={[styles.chip, typeId === t.id && styles.chipOn]} onPress={() => setTypeId(t.id)}
                    accessibilityRole="radio" accessibilityState={{ selected: typeId === t.id }}>
                    <Text style={[styles.chipText, typeId === t.id && styles.chipTextOn]}>{t.name}{t.level ? ` · ${LEVEL_LABEL[t.level]}` : ''}</Text>
                  </Pressable>
                ))}
              </View>
              {type?.hasNumber && (<>
                <Text style={styles.label}>Number</Text>
                <TextInput style={styles.input} value={number} onChangeText={setNumber} maxLength={100} autoCapitalize="characters" />
              </>)}
              <Text style={styles.label}>Issued by (optional)</Text>
              <TextInput style={styles.input} value={issuedBy} onChangeText={setIssuedBy} maxLength={120} />
              <Text style={styles.label}>Issue date (optional)</Text>
              <DateBoxes value={issued} onChange={setIssued} label="Issue date" />
              {type?.hasExpiry && (<>
                <Text style={styles.label}>Expiry date</Text>
                <DateBoxes value={expiry} onChange={setExpiry} label="Expiry date" />
              </>)}
              <Text style={[styles.muted, styles.small]}>The office checks it before it counts. You can add a photo or file next.</Text>
              <View style={styles.row}>
                <Pressable style={[styles.button, styles.grow]} disabled={busy || !type} onPress={save}><Text style={styles.buttonText}>Add</Text></Pressable>
                <Pressable style={[styles.button, styles.secondary, styles.grow]} onPress={() => setAdding(false)}>
                  <Text style={[styles.buttonText, styles.secondaryText]}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable style={[styles.button, styles.secondary]} onPress={() => startAdding(null)}>
              <Text style={[styles.buttonText, styles.secondaryText]}>Add a {word.lower}</Text>
            </Pressable>
          )}
        </>
      )}
      {footer}
    </ScrollView>
  );
}
