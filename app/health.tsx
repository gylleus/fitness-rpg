import { useRouter } from 'expo-router';
import { Alert, Platform, Text } from 'react-native';
import { useHealth } from '../src/health/HealthProvider';
import { healthName, openHealthSettings } from '../src/health/native';
import { Button, Card, colors, PageHeading, Screen, ui } from '../src/ui/theme';
export default function HealthScreen() {
  const health = useHealth();
  const router = useRouter();
  return <Screen>
    <Button compact secondary label="← Camp" onPress={() => router.replace('/')} />
    <PageHeading eyebrow="Fitness / connected steps" title="Every step counts." />
    <Card>
      <Text style={ui.heading}>{healthName}</Text>
      <Text style={ui.body}>Connect once. Your daily steps then refresh automatically when you open the app and while you play. Spend steps to travel from camp: normal dungeons are free, heroic costs 1,000 steps, and mythic costs 5,000.</Text>
      <Text style={ui.small}>{Platform.OS === 'android' ? 'In Samsung Health, open Settings → Health Connect and allow Samsung Health to share steps. Then allow Fitness RPG to read steps here. Phone and watch steps are combined by Health Connect.' : 'Allow Fitness RPG to read Steps in Apple Health. HealthKit supplies the combined step total from your phone and watch.'}</Text>
      {health.error && <Text accessibilityRole="alert" style={{ color: colors.red }}>{health.error}</Text>}
      <Button label={health.busy ? 'Syncing…' : health.connected ? 'Sync steps now' : `Connect ${healthName}`} disabled={health.busy} onPress={() => { void (health.connected ? health.sync() : health.connect()); }} />
      {health.syncedAt && <Text style={ui.small}>Last synced {new Date(health.syncedAt).toLocaleString()}</Text>}
      <Button secondary label="Open health settings" onPress={() => { void openHealthSettings().catch(() => Alert.alert('Open phone settings', `Open ${healthName} from your phone settings to manage step access.`)); }} />
      {health.connected && <Button compact secondary label="Disconnect step syncing" onPress={health.disconnect} />}
      <Text style={ui.small}>Steps can take a few minutes to arrive from your watch or health app. If the total is empty, check step sharing and read permission there. Saved totals remain visible if access is disconnected.</Text>
    </Card>
    <Card><Text style={ui.heading}>Your health data stays yours.</Text><Text style={ui.body}>Fitness RPG reads step totals for your daily dungeon travel budget and activity history. It stores these totals and your recorded GPS routes on this phone. It does not send health or location data to a server or share it with advertisers.</Text><Text style={ui.small}>Step access is read-only. GPS is used only during a run you start, and stops when you pause, finish, or discard it. Manage permissions in phone settings and delete saved runs from Progress. Strava syncing is not enabled.</Text></Card>
  </Screen>;
}
