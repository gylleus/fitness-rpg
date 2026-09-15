import { useState, type PropsWithChildren } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { menuArt } from './art';
import { MenuIcon, type MenuIconName } from './MenuIcon';
import { PanelFrame } from './PanelFrame';

export const colors = {
  bg: '#151620', panel: '#232630', raised: '#30343e', border: '#565044', text: '#f1e6ce',
  muted: '#b4b2ab', green: '#b8cc97', gold: '#d7bb82', purple: '#b5b5e2', red: '#ed9a86',
};
const titleFont = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' });
export const ui = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  flex: { flex: 1 },
  label: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' },
  title: { color: colors.text, fontFamily: titleFont, fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  heading: { color: colors.text, fontFamily: titleFont, fontSize: 20, fontWeight: '700' },
  body: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  small: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  number: { color: colors.text, fontSize: 27, fontWeight: '700', fontVariant: ['tabular-nums'] },
  divider: { height: 1, backgroundColor: colors.border, opacity: 0.65, marginVertical: 4 },
  input: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, color: colors.text, borderRadius: 4, padding: 15, fontSize: 18 },
});

export function Screen({ children }: PropsWithChildren) {
  return <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <Image source={menuArt.background} resizeMode="cover" accessible={false} style={[StyleSheet.absoluteFill, { width: '100%', height: '100%', opacity: 0.5 }]} />
    <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, gap: 22, paddingBottom: 36, maxWidth: 720, width: '100%', alignSelf: 'center' }}>{children}</ScrollView>
    </SafeAreaView>
  </View>;
}
export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[{ backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, padding: 20, borderRadius: 3, gap: 14, minHeight: 44 }, style]}>
    <PanelFrame />
    {children}
  </View>;
}
export function Button({ label, onPress, secondary = false, disabled = false, compact = false, icon }: {
  label: string; onPress: () => void; secondary?: boolean; disabled?: boolean; compact?: boolean; icon?: MenuIconName;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ backgroundColor: secondary ? colors.raised : '#be985f', borderRadius: 4, borderWidth: 1,
      borderColor: secondary ? colors.border : '#826744', overflow: 'hidden',
      paddingHorizontal: compact ? 12 : 22, paddingVertical: compact ? 12 : 17, minHeight: 48,
      alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
      transform: [{ translateY: pressed ? 1 : 0 }] })}>
    {/* Clip the source's unused lower margin at runtime; never bake labels into artwork. */}
    {!secondary && <Image source={menuArt.button} resizeMode="stretch" accessible={false}
      style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '128%' }} />}
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
      {icon && <MenuIcon name={icon} size={18} color={secondary ? colors.gold : '#241e17'} />}
      <Text style={{ flexShrink: 1, textAlign: 'center', color: secondary ? colors.text : '#241e17', fontSize: compact ? 12 : 14, fontWeight: '800' }}>{label}</Text>
    </View>
  </Pressable>;
}
export function Meter({ value, max, color = colors.green, label }: { value: number; max: number; color?: string; label?: string }) {
  const safeMax = Number.isFinite(max) ? Math.max(0, max) : 0;
  const now = Number.isFinite(value) ? Math.min(safeMax, Math.max(0, value)) : 0;
  return <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: safeMax, now }}
    style={{ height: 8, borderRadius: 1, backgroundColor: colors.bg, borderWidth: 1, borderColor: '#4a483e', overflow: 'hidden' }}>
    <View style={{ height: '100%', width: `${safeMax > 0 ? now / safeMax * 100 : 0}%`, backgroundColor: color }} />
  </View>;
}
export function PageHeading({ eyebrow, title, right }: { eyebrow: string; title: string; right?: React.ReactNode }) {
  return <View style={{ gap: 10 }}>
    <View style={ui.between}><Text style={[ui.label, ui.flex, { color: colors.gold }]}>{eyebrow}</Text>{right}</View>
    <Text accessibilityRole="header" style={ui.title}>{title}</Text>
  </View>;
}
export function SectionHeading({ title, detail, icon }: { title: string; detail?: string; icon?: MenuIconName }) {
  return <View style={ui.between}>
    <View style={[ui.row, ui.flex, { gap: 8 }]}>{icon && <MenuIcon name={icon} size={20} />}<Text accessibilityRole="header" style={[ui.heading, { flexShrink: 1 }]}>{title}</Text></View>
    {detail && <Text style={ui.small}>{detail}</Text>}
  </View>;
}
export function Gold({ amount }: { amount: number }) {
  return <View accessible accessibilityLabel={`${amount.toLocaleString()} gold`} style={{ flexDirection: 'row', gap: 7, alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 3, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: '#2c2925' }}>
    <MenuIcon name="coin" size={16} /><Text style={{ color: colors.gold, fontSize: 13, fontWeight: '800' }}>{amount.toLocaleString()}</Text>
  </View>;
}
export function Disclosure({ title, children }: PropsWithChildren<{ title: string }>) {
  const [expanded, setExpanded] = useState(false);
  return <View style={{ gap: 12 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)}
      style={({ pressed }) => ({ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, opacity: pressed ? 0.7 : 1 })}>
      <Text style={[ui.small, { flex: 1, color: colors.gold }]}>{title}</Text><Text style={{ color: colors.gold }}>{expanded ? '−' : '+'}</Text>
    </Pressable>
    {expanded && children}
  </View>;
}
