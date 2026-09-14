import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { db } from '../../src/db/client';
import { claimChallenge } from '../../src/db/game';
import { useGame } from '../../src/game/GameProvider';
import { multiplierLabel, percentLabel } from '../../src/game/items';
import { CHALLENGES, dayStart } from '../../src/game/rules';
import { useHealth } from '../../src/health/HealthProvider';
import { healthName } from '../../src/health/native';
import { activeRecording } from '../../src/db/recordings';
import { CampScene } from '../../src/ui/CampScene';
import { Button, Card, colors, Gold, Meter, PageHeading, Screen, ui } from '../../src/ui/theme';

export default function Camp() {
  const { data, perform } = useGame();
  const { hero, stats, today, claimed } = data;
  const router = useRouter();
  const health = useHealth();
  const running = activeRecording(db);
  return <Screen>
    <PageHeading eyebrow="Fitness RPG / your daily adventure" title="Welcome to camp." right={<Gold amount={hero.gold} />} />
    <Card>
      <View style={ui.between}><View style={{ gap: 4 }}><Text style={ui.heading}>The Wayfarer</Text><Text style={ui.small}>KNIGHT · LEVEL {stats.level}</Text></View><Text style={{ color: colors.green, fontSize: 12, fontWeight: '700' }}>READY TO ROAM</Text></View>
      <CampScene />
      <View style={ui.between}><Text style={ui.small}>Adventure experience</Text><Text style={ui.small}>{hero.xp % 100} / 100 XP</Text></View>
      <Meter value={hero.xp % 100} max={100} color={colors.gold} label="Experience toward next level" />
      <View style={ui.divider} />
      <View style={ui.row}>
        <View style={[ui.flex, { gap: 5 }]}><Text style={ui.label}>Damage per hit</Text><Text style={ui.number}>{data.damageMin}–{data.damageMax}</Text><Text style={ui.small}>{stats.baseDamageMin}–{stats.baseDamageMax} from hero & gear</Text></View>
        <View style={[ui.flex, { gap: 5 }]}><Text style={ui.label}>Health</Text><Text style={ui.number}>{data.currentHealth} <Text style={{ fontSize: 14, color: colors.green }}>/ {stats.health} HP</Text></Text><Text style={ui.small}>{stats.dailyHealth} bonus today · wins spend HP</Text></View>
      </View>
      <View style={ui.divider} />
      <Text style={ui.label}>Pushup power</Text>
      <Text style={ui.number}>{today.pushups} <Text style={{ fontSize: 14, color: colors.green }}>today · {multiplierLabel(data.damageMultiplier)} damage</Text></Text>
      <Text style={ui.small}>{percentLabel(stats.pushupDamageCoefficient * 10000)} bonus damage per pushup{hero.focusAttacks > 0 ? ` · focus: ${hero.focusAttacks} attacks left` : ''}. Attacks never consume pushups. The bonus resets at 5 AM device time. Focus adds 2 percentage points per pushup.</Text>
      <Text style={[ui.body, { color: colors.purple }]}>{percentLabel(stats.dodgeBps)} dodge today · from running</Text>
      <Button label={data.latestBattle?.status === 'active' ? 'Continue your expedition  →' : 'Enter the dungeon  →'} onPress={() => data.latestBattle?.status === 'active' ? router.push('/expedition') : router.navigate('/dungeon')} />
    </Card>

    <View style={{ gap: 14 }}>
      <View style={ui.between}><Text style={ui.heading}>Today fuels your hero</Text><Text style={ui.small}>{new Date(dayStart(today.day)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text></View>
      <View style={ui.row}>
        <Card style={ui.flex}><Text style={ui.label}>Pushups</Text><Text style={ui.number}>{today.pushups}</Text><Text style={ui.small}>+{today.pushups} saved today</Text></Card>
        <Card style={ui.flex}><Text style={ui.label}>Steps</Text><Text style={ui.number}>{today.steps.toLocaleString()}</Text><Text style={ui.small}>+{Math.floor(today.steps / 100)} health today</Text></Card>
      </View>
      <Card style={{ backgroundColor: '#202b32' }}>
        <View style={ui.between}><View style={{ gap: 5 }}><Text style={[ui.label, { color: colors.purple }]}>Running agility</Text><Text style={ui.heading}>{(today.distanceMeters / 1000).toFixed(2)} km today</Text></View><Text style={{ color: colors.purple, fontSize: 26, fontWeight: '800' }}>{percentLabel(stats.dodgeBps)}</Text></View>
        <Text style={ui.small}>Distance and pace build dodge, up to 30% each day. Dodge rolls repeat when retrying the same dungeon. {today.runningSteps.toLocaleString()} running steps included in today&apos;s total.</Text>
      </Card>
      <Button label="Train pushups  ·  increase damage" onPress={() => router.push('/session')} />
      <View style={ui.row}><View style={ui.flex}><Button secondary label={health.connected ? "Connected steps" : "Connect steps"} onPress={() => router.push('/health')} /></View><View style={ui.flex}><Button secondary label={running ? "Return to your run" : "Start running"} onPress={() => router.push('/run')} /></View></View>
      <Text style={ui.small}>{health.connected ? `${healthName} steps sync automatically. ${health.syncedAt ? `Last synced ${new Date(health.syncedAt).toLocaleTimeString()}.` : 'Syncing your steps…'}` : 'Connect your phone’s health app to sync steps automatically.'} Step health, pushup damage, and running dodge reset daily at 5 AM device time. Your fitness history, items, and gold stay.</Text>
      {health.error && <Text style={[ui.small, { color: colors.gold }]}>Step sync needs attention. Open Connected steps to retry.</Text>}
    </View>

    <View style={{ gap: 14 }}><Text style={ui.heading}>A little quest, every day</Text><Text style={ui.body}>Choose your own pace. Each completed quest earns 20 gold.</Text>
      {CHALLENGES.map((challenge) => {
        const progress = today[challenge.metric];
        const done = claimed.includes(challenge.id);
        const complete = progress >= challenge.target;
        return <Card key={challenge.id}>
          <View style={ui.between}><View style={[ui.flex, { gap: 4 }]}><Text style={ui.heading}>{challenge.name}</Text><Text style={ui.small}>{challenge.description}</Text></View><Text style={{ color: colors.gold, fontWeight: '700' }}>◆ 20</Text></View>
          <Meter value={progress} max={challenge.target} label={challenge.description} />
          <View style={ui.between}><Text style={ui.small}>{Math.min(progress, challenge.target).toLocaleString()} / {challenge.target.toLocaleString()}{challenge.id === 'run' ? ' m' : ''}</Text><Button compact secondary={!complete} label={done ? 'Claimed ✓' : complete ? 'Claim gold' : 'In progress'} disabled={done || !complete} onPress={() => perform(() => claimChallenge(db, challenge.id))} /></View>
        </Card>;
      })}
    </View>
  </Screen>;
}
