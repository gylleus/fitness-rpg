import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

export default function Home() {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Fitness RPG</Text>
      <Text style={styles.body}>
        Pushup counter — camera pipeline not wired up yet.
      </Text>
      <Link href="/session" style={styles.link}>
        Start pushups
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  heading: { fontSize: 28, fontWeight: '700' },
  body: { fontSize: 15, opacity: 0.7, textAlign: 'center' },
  link: { marginTop: 16, fontSize: 17, fontWeight: '600', color: '#2563eb' },
});
