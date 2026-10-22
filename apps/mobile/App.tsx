import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

// Set EXPO_PUBLIC_API_URL in .env (for a phone on the same Wi-Fi, use your computer's LAN address).
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://staging.cropwms.com/api';

export default function App() {
  const [status, setStatus] = useState('checking…');

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then(r => r.json())
      .then((h: { status: string }) => setStatus(h.status))
      .catch(() => setStatus('unreachable'));
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>CROP</Text>
      <Text style={styles.subtitle}>Worker app</Text>
      <Text style={styles.status}>Server: {status}</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 32, fontWeight: '700', color: '#1f3a5f' },
  subtitle: { fontSize: 16, color: '#5d6775', marginTop: 4 },
  status: { fontSize: 14, marginTop: 24 },
});
