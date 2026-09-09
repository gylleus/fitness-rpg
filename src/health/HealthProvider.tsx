import { createContext, useCallback, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { db } from '../db/client';
import { useGame } from '../game/GameProvider';
import { authorizeHealth, healthAvailable, healthName } from './native';
import { getHealthConnection, setHealthConnected, syncHealth } from './sync';

const HealthContext = createContext<{
  connected: boolean; busy: boolean; error: string | null; syncedAt: number | null;
  connect: () => Promise<void>; sync: () => Promise<void>; disconnect: () => void;
} | null>(null);
export function HealthProvider({ children }: PropsWithChildren) {
  const { refresh, foreground, data } = useGame();
  const [connected, setConnected] = useState(() => getHealthConnection(db)?.enabled ?? false);
  const [syncedAt, setSyncedAt] = useState<number | null>(() => getHealthConnection(db)?.syncedAt ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sync = useCallback(async () => {
    setBusy(true);
    try { await syncHealth(db); setSyncedAt(getHealthConnection(db)?.syncedAt ?? null); setError(null); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Step sync failed. Your saved activity is safe.'); }
    finally { setBusy(false); }
  }, [refresh]);
  const connect = async () => {
    setBusy(true); setError(null);
    try {
      if (!await healthAvailable()) throw new Error(`${healthName} is unavailable. Open health settings to install or update it.`);
      if (!await authorizeHealth()) throw new Error(`Step access was not granted. Allow read access in ${healthName} and try again.`);
      setHealthConnected(db, true); setConnected(true);
      await sync();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not connect to your health app.'); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!connected || !foreground) return;
    // The platform data source is external to React; expose its refresh state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void sync();
    const timer = setInterval(() => { void sync(); }, 60_000);
    return () => clearInterval(timer);
  }, [connected, foreground, data.today.day, sync]);
  return <HealthContext.Provider value={{ connected, busy, error, syncedAt, connect, sync, disconnect: () => { setHealthConnected(db, false); setConnected(false); setError(null); } }}>{children}</HealthContext.Provider>;
}
export function useHealth() {
  const context = useContext(HealthContext);
  if (!context) throw new Error('HealthProvider is required.');
  return context;
}
