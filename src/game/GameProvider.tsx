import { createContext, useCallback, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, Alert, AppState, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db, useDatabaseMigrations } from '../db/client';
import { getGameSnapshot, type GameSnapshot } from '../db/game';
import { localDay, nextMidnight } from './rules';
import { Button, colors, ui } from '../ui/theme';

const GameContext = createContext<{
  data: GameSnapshot;
  refresh: () => void;
  perform: (action: () => unknown) => boolean;
  foreground: boolean;
} | null>(null);

export function GameProvider({ children }: PropsWithChildren) {
  const insets = useSafeAreaInsets();
  const { success, error: migrationError } = useDatabaseMigrations();
  const [data, setData] = useState<GameSnapshot | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const refresh = useCallback(() => {
    try { setData(getGameSnapshot(db)); setReadError(null); }
    catch (error) { setReadError(error instanceof Error ? error.message : 'Could not read your saved game.'); }
  }, []);
  const perform = useCallback((action: () => unknown) => {
    try { action(); refresh(); return true; }
    catch (error) { Alert.alert('Could not save', error instanceof Error ? error.message : 'Please try again.'); return false; }
  }, [refresh]);

  // The database becomes readable only after the external migration completes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (success) refresh(); }, [success, refresh]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
      if (state === 'active' && success) refresh();
    });
    return () => listener.remove();
  }, [success, refresh]);
  const day = data?.today.day;
  useEffect(() => {
    if (!success || !foreground) return;
    const midnight = setTimeout(refresh, Math.max(1, nextMidnight() - Date.now() + 50));
    // Also detect a timezone or system-clock change while the app stays open.
    const clockCheck = setInterval(() => { if (localDay() !== day) refresh(); }, 30_000);
    return () => { clearTimeout(midnight); clearInterval(clockCheck); };
  }, [success, foreground, day, refresh]);

  if (migrationError || !data) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 28, gap: 16 }}>
    <Text style={ui.title}>{migrationError || readError ? 'Your save needs attention' : 'Setting up camp…'}</Text>
    {migrationError || readError ? <>
      <Text style={ui.body}>{migrationError?.message ?? readError}</Text>
      <Text style={ui.small}>Your stored data has been kept. {migrationError ? 'Restart the app to retry.' : 'Try reading your save again.'}</Text>
      {!migrationError && <Button label="Retry" onPress={refresh} />}
    </> : <ActivityIndicator color={colors.green} />}
  </View>;
  // Once mounted, navigation and in-progress workouts must survive a transient
  // read failure. Keep the last snapshot and let the player retry the refresh.
  return <GameContext.Provider value={{ data, refresh, perform, foreground }}>
    <View style={{ flex: 1 }}>
      {children}
      {readError && <View accessibilityRole="alert" style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, padding: 16, gap: 10, backgroundColor: colors.panel, borderColor: colors.red, borderWidth: 1, borderRadius: 16 }}>
        <Text style={ui.heading}>Stats could not refresh.</Text>
        <Text style={ui.body}>Retry to load the latest saved progress.</Text>
        <Button compact label="Retry refresh" onPress={refresh} />
      </View>}
    </View>
  </GameContext.Provider>;
}
export function useGame() {
  const context = useContext(GameContext);
  if (!context) throw new Error('GameProvider is required.');
  return context;
}
