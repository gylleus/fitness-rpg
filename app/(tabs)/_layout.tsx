import { Tabs } from 'expo-router';
import { Image, StyleSheet, View } from 'react-native';
import { colors } from '../../src/ui/theme';
import { menuArt } from '../../src/ui/art';
import { MenuIcon, type MenuIconName } from '../../src/ui/MenuIcon';

const tabs: { name: string; title: string; icon: MenuIconName }[] = [
  { name: 'index', title: 'Camp', icon: 'camp' },
  { name: 'dungeon', title: 'Dungeon', icon: 'sword' },
  { name: 'forge', title: 'Inventory', icon: 'pack' },
  { name: 'progress', title: 'Progress', icon: 'journal' },
];

export default function TabLayout() {
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.gold, tabBarInactiveTintColor: colors.muted,
    tabBarStyle: { backgroundColor: colors.bg, borderTopColor: '#806849', borderTopWidth: 1 },
    tabBarItemStyle: { paddingTop: 4, paddingBottom: 3 },
    tabBarLabelStyle: { fontWeight: '700', fontSize: 10, letterSpacing: 0.4 },
    tabBarBackground: () => <Image source={menuArt.background} resizeMode="cover" accessible={false} style={[StyleSheet.absoluteFill, { width: '100%', height: '100%', opacity: 0.5 }]} /> }}>
    {tabs.map(tab => <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.title,
      tabBarIcon: ({ color, focused }) => <View style={{ width: 44, height: 29, alignItems: 'center', justifyContent: 'center',
        backgroundColor: focused ? '#d7bb8218' : 'transparent', borderRadius: 3,
        borderBottomWidth: 2, borderBottomColor: focused ? colors.gold : 'transparent' }}><MenuIcon name={tab.icon} color={color} size={22} /></View> }} />)}
  </Tabs>;
}
