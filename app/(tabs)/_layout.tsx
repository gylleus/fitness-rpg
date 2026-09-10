import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { colors } from '../../src/ui/theme';

export default function TabLayout() {
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.green, tabBarInactiveTintColor: colors.muted,
    tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border }, tabBarLabelStyle: { fontWeight: '700', fontSize: 11 } }}>
    {[
      { name: 'index', title: 'Camp', icon: '⌂' }, { name: 'dungeon', title: 'Dungeon', icon: '⚔' },
      { name: 'forge', title: 'Inventory', icon: '◆' }, { name: 'progress', title: 'Progress', icon: '▥' },
    ].map((tab) => <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.title, tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 25 }}>{tab.icon}</Text> }} />)}
  </Tabs>;
}
