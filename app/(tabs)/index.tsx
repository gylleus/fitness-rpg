import { useRouter } from 'expo-router';
import { Alert, Text, View } from 'react-native';
import { db } from '../../src/db/client';
import { claimChallenge } from '../../src/db/game';
import { addDevTravelSteps, devStepsEnabled, resetDailyData } from '../../src/db/dev';
import { useGame } from '../../src/game/GameProvider';
import { multiplierLabel, percentLabel } from '../../src/game/items';
import { CHALLENGES, dayStart } from '../../src/game/rules';
import { useHealth } from '../../src/health/HealthProvider';
import { healthName } from '../../src/health/native';
import { activeRecording } from '../../src/db/recordings';
import { MenuIcon } from '../../src/ui/MenuIcon';
import { CampScene } from '../../src/ui/CampScene';
import { Button, Card, colors, Disclosure, Gold, Meter, PageHeading, Screen, SectionHeading, ui } from '../../src/ui/theme';

export default function Camp() {
  const { data, perform } = useGame();
  const { hero, stats, today, claimed } = data;
  const router = useRouter();
  const health = useHealth();
  const running = activeRecording(db);
  return <Screen>
    <PageHeading eyebrow="Your daily adventure" title="Welcome to camp." right={<Gold amount={hero.gold} />} />
    <View style={{ gap: 0 }}>
      <CampScene />
      <Card>
        <View style={ui.between}>
          <View style={{ gap: 4 }}><Text style={ui.heading}>The Wayfarer</Text><Text style={ui.label}>Level {stats.level} · adventurer</Text></View>
          <Text style={[ui.label, { color: colors.green, maxWidth: '40%', textAlign: 'right' }]}>{data.latestBattle?.status === 'active' ? 'On expedition' : data.currentHealth <= 0 ? 'Rest & recover' : 'Ready to roam'}</Text>
        </View>
        <View style={{ gap: 7 }}>
          <View style={ui.between}><Text style={ui.small}>Adventure experience</Text><Text style={[ui.small, { color: colors.gold }]}>{hero.xp % 100} / 100 XP</Text></View>
          <Meter value={hero.xp % 100} max={100} color={colors.gold} label="Experience toward next level" />
        </View>
        <View style={ui.row}>
          <View style={[ui.flex, { gap: 4 }]}><Text style={ui.label}>Damage per hit</Text><Text style={ui.number}>{data.damageMin}–{data.damageMax}</Text><Text style={[ui.small, { color: colors.green }]}>{multiplierLabel(data.damageMultiplier)} damage</Text></View>
          <View style={{ width: 1, height: 48, backgroundColor: colors.border }} />
          <View style={[ui.flex, { gap: 4 }]}><Text style={ui.label}>Health</Text><Text style={ui.number}>{data.currentHealth}<Text style={{ fontSize: 14, color: colors.muted }}> / {stats.health}</Text></Text><Text style={ui.small}>Wins carry remaining health</Text></View>
        </View>
        <Button icon="sword" label={data.latestBattle?.status === 'active' ? 'Continue your expedition  →' : 'Enter the dungeon  →'} onPress={() => data.latestBattle?.status === 'active' ? router.push('/expedition') : router.navigate('/dungeon')} />
      </Card>
    </View>

    <View style={{ gap: 12 }}>
      <SectionHeading title="Today fuels your hero" detail={new Date(dayStart(today.day)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
      <View style={[ui.row, { alignItems: 'stretch' }]}>
        <Card style={[ui.flex, { padding: 16, gap: 8 }]}>
          <MenuIcon name="strength" color={colors.green} /><Text style={ui.label}>Pushups</Text><Text style={ui.number}>{today.pushups}</Text><Text style={ui.small}>+{today.pushups} saved today</Text>
        </Card>
        <Card style={[ui.flex, { padding: 16, gap: 8 }]}>
          <MenuIcon name="steps" /><Text style={ui.label}>Travel steps</Text><Text style={ui.number}>{data.travelSteps.available.toLocaleString()}</Text><Text style={ui.small}>{data.travelSteps.spent.toLocaleString()} spent · {today.steps.toLocaleString()} earned today</Text>
          {data.travelSteps.bonus > 0 && <Text style={ui.small}>+{data.travelSteps.bonus.toLocaleString()} dev steps</Text>}
          {devStepsEnabled() && <Button compact secondary label="Add 500 steps (dev)" onPress={() => perform(() => addDevTravelSteps(db))} />}
        </Card>
      </View>
      <Button icon="strength" label="Train pushups  ·  increase damage" onPress={() => router.push('/session')} />
      <Card style={{ gap: 12 }}>
        <View style={ui.between}>
          <View style={[ui.row, ui.flex]}><MenuIcon name="run" color={colors.purple} /><View style={[ui.flex, { gap: 4 }]}><Text style={ui.label}>Running agility</Text><Text style={ui.heading}>{(today.distanceMeters / 1000).toFixed(2)} km today</Text></View></View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}><Text style={[ui.heading, { color: colors.purple }]}>{percentLabel(stats.dodgeBps)}</Text><Text style={ui.small}>dodge</Text></View>
        </View>
        <Button secondary icon="run" label={running ? 'Return to your run' : 'Start running'} onPress={() => router.push('/run')} />
      </Card>
      <Button secondary icon="steps" label={health.connected ? 'Connected steps' : 'Connect steps'} onPress={() => router.push('/health')} />
      <Text style={ui.small}>{health.connected ? healthName + ' steps sync automatically.' : 'Connect your phone’s health app to fuel your next expedition.'}</Text>
      {health.error && <Text accessibilityRole="alert" style={[ui.small, { color: colors.gold }]}>Step sync needs attention. Open Connected steps to retry.</Text>}
      <Disclosure title="How your daily activity builds power">
        <Text style={ui.small}>{percentLabel(stats.pushupDamageCoefficient * 10000)} bonus damage per pushup. Attacks never consume pushups. Focus adds 2 percentage points per pushup.{hero.focusAttacks > 0 ? ' Focus: ' + hero.focusAttacks + ' attacks left.' : ''}</Text>
        <Text style={ui.small}>Steps pay for dungeon travel: normal is free, heroic costs 1,000, and mythic costs 5,000. Distance and pace build dodge, up to 30% each day. {today.runningSteps.toLocaleString()} running steps are included in today’s total.</Text>
        <Text style={ui.small}>Travel steps, pushup damage, and running dodge reset daily at 5 AM device time. Your fitness history, items, and gold stay.</Text>
        {health.syncedAt && <Text style={ui.small}>Last step sync: {new Date(health.syncedAt).toLocaleTimeString()}.</Text>}
      </Disclosure>
    </View>

    <View style={{ gap: 12 }}>
      <SectionHeading title="The quest board" icon="journal" detail={claimed.length + ' / ' + CHALLENGES.length + ' claimed'} />
      <Text style={ui.body}>A little movement, a little gold. Go at your own pace.</Text>
      {CHALLENGES.map((challenge) => {
        const progress = today[challenge.metric];
        const done = claimed.includes(challenge.id);
        const complete = progress >= challenge.target;
        return <Card key={challenge.id}>
          <View style={ui.between}>
            <View style={[ui.flex, { gap: 4 }]}><Text style={ui.heading}>{challenge.name}</Text><Text style={ui.small}>{challenge.description}</Text></View>
            <Gold amount={20} />
          </View>
          <Meter value={progress} max={challenge.target} color={done ? colors.muted : colors.gold} label={challenge.description} />
          <View style={[ui.between, { flexWrap: 'wrap' }]}>
            <Text style={ui.small}>{Math.min(progress, challenge.target).toLocaleString()} / {challenge.target.toLocaleString()}{challenge.id === 'run' ? ' m' : ''}</Text>
            <Button compact secondary={!complete || done} label={done ? 'Claimed ✓' : complete ? 'Claim gold' : 'In progress'} disabled={done || !complete} onPress={() => perform(() => claimChallenge(db, challenge.id))} />
          </View>
        </Card>;
      })}
    </View>
    {__DEV__ && <Card>
      <Text style={ui.label}>Development tools</Text>
      <Text style={ui.small}>Clear the current fitness day’s pushups, steps, runs, and quests. Earlier days, gear, gold, and XP stay saved. Step syncing pauses until you reconnect.</Text>
      <Button secondary label="Reset data" disabled={!!running} onPress={() => Alert.alert('Reset today’s data?',
        'Delete this fitness day’s activity and quest claims, restore health, and end active combat. Step syncing will disconnect; reconnecting imports your phone’s steps again.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Reset data', style: 'destructive', onPress: () => {
            if (perform(() => resetDailyData(db))) health.disconnect();
          } },
        ])} />
      {running && <Text style={ui.small}>Finish or discard your current run to reset daily data.</Text>}
    </Card>}
  </Screen>;
}
