import type { PropsWithChildren } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const colors = {
  bg: '#101918', panel: '#1a2724', raised: '#22332e', border: '#32453c', text: '#f4f0df',
  muted: '#abbcaf', green: '#b3ed9b', gold: '#f2ce79', purple: '#c9bcf6', red: '#f5a39a',
};
export const ui = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  flex: { flex: 1 },
  label: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.6, textTransform: 'uppercase' },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.8 },
  heading: { color: colors.text, fontSize: 19, fontWeight: '700' },
  body: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  small: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  number: { color: colors.text, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  input: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, color: colors.text, borderRadius: 12, padding: 15, fontSize: 18 },
});

export function Screen({ children }: PropsWithChildren) {
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'left', 'right']}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 22, gap: 24, paddingBottom: 36, maxWidth: 720, width: '100%', alignSelf: 'center' }}>{children}</ScrollView>
  </SafeAreaView>;
}
export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[{ backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, padding: 18, borderRadius: 20, gap: 14 }, style]}>{children}</View>;
}
export function Button({ label, onPress, secondary = false, disabled = false, compact = false }: {
  label: string; onPress: () => void; secondary?: boolean; disabled?: boolean; compact?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ backgroundColor: secondary ? colors.raised : colors.green, borderRadius: 12,
      paddingHorizontal: compact ? 13 : 18, paddingVertical: compact ? 11 : 15, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : pressed ? 0.7 : 1 })}>
    <Text style={{ color: secondary ? colors.text : colors.bg, fontSize: compact ? 12 : 14, fontWeight: '800' }}>{label}</Text>
  </Pressable>;
}
export function Meter({ value, max, color = colors.green, label }: { value: number; max: number; color?: string; label?: string }) {
  return <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max, now: Math.min(max, Math.max(0, value)) }}
    style={{ height: 7, borderRadius: 4, backgroundColor: colors.bg, overflow: 'hidden' }}>
    <View style={{ height: '100%', width: `${Math.min(100, Math.max(0, max > 0 ? value / max * 100 : 0))}%`, backgroundColor: color, borderRadius: 4 }} />
  </View>;
}
export function PageHeading({ eyebrow, title, right }: { eyebrow: string; title: string; right?: React.ReactNode }) {
  return <View style={ui.between}><View style={{ gap: 7, flex: 1 }}><Text style={ui.label}>{eyebrow}</Text><Text style={ui.title}>{title}</Text></View>{right}</View>;
}
export function Gold({ amount }: { amount: number }) {
  return <View style={{ borderRadius: 20, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#332f22' }}><Text style={{ color: colors.gold, fontSize: 13, fontWeight: '800' }}>◆ {amount.toLocaleString()}</Text></View>;
}
