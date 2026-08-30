import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerTitleStyle: { fontWeight: '600' } }}>
        <Stack.Screen name="index" options={{ title: 'Fitness RPG' }} />
        {/* The session screen owns the whole viewport: the phone is on the floor
            metres away, so chrome would only steal space from the rep count. */}
        <Stack.Screen name="session" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
