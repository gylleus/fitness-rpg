import { StyleSheet, Text, View } from 'react-native';

/**
 * Live pushup session. Camera preview, skeleton overlay and rep HUD land here
 * once the pose pipeline exists (see beads E2/E5).
 */
export default function Session() {
  return (
    <View style={styles.container}>
      <Text style={styles.count}>0</Text>
      <Text style={styles.label}>reps</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  count: { fontSize: 120, fontWeight: '800', color: '#fff', fontVariant: ['tabular-nums'] },
  label: { fontSize: 18, color: '#888', letterSpacing: 2, textTransform: 'uppercase' },
});
