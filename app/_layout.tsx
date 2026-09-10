import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GameProvider } from '../src/game/GameProvider';
import { colors } from '../src/ui/theme';
import { HealthProvider } from '../src/health/HealthProvider';
import '../src/running/tracker';

export default function RootLayout() {
  return (
    <GameProvider>
      <HealthProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, orientation: 'portrait', statusBarHidden: false, navigationBarHidden: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        {/* The session screen owns the whole viewport: the phone is on the floor
            metres away, so chrome would only steal space from the rep count. */}
        <Stack.Screen name="session" options={{ headerShown: false }} />
        <Stack.Screen name="activity" options={{ presentation: 'modal' }} />
        <Stack.Screen name="health" options={{ presentation: 'modal' }} />
        <Stack.Screen name="run" />
        <Stack.Screen name="expedition" options={{ orientation: 'landscape', statusBarHidden: true, navigationBarHidden: true, animation: 'fade' }} />
      </Stack>
      </HealthProvider>
    </GameProvider>
  );
}
