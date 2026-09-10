import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, Pressable, Text, View } from 'react-native';
import { db } from '../../src/db/client';
import { deleteRun } from '../../src/db/game';
import { useGame } from '../../src/game/GameProvider';
import { dayStart, paceLabel, runDodgeBps, type FitnessDay } from '../../src/game/rules';
import { percentLabel, multiplierLabel } from '../../src/game/items';
import { Button, Card, colors, PageHeading, Screen, ui } from '../../src/ui/theme';

type Metric = 'pushups' | 'steps' | 'distanceMeters';
const metricNames = { pushups: 'Pushups', steps: 'Steps', distanceMeters: 'Run km' };
function metricValue(day: FitnessDay, metric: Metric) { return metric === 'distanceMeters' ? day[metric] / 1000 : day[metric]; }
function shortNumber(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : Number(n.toFixed(1)).toString(); }

export default function Progress() {
  const { data, perform } = useGame();
  const router = useRouter();
  const [metric, setMetric] = useState<Metric>('pushups');
  const [selected, setSelected] = useState<string | null>(null);
  const day = data.history.find((d) => d.day === selected) ?? data.today;
  const max = Math.max(1, ...data.history.map((d) => metricValue(d, metric)));
  const weekTotal = data.history.reduce((sum, d) => sum + metricValue(d, metric), 0);
  const selectedRuns = data.recentRuns.filter((r) => r.day === day.day);
  return <Screen>
    <PageHeading eyebrow="Your journal / real-world progress" title="Look how far you’ve come." />
    <Card>
      <Text style={ui.label}>Last seven days · including today</Text>
      <Text style={ui.number}>{metric === 'distanceMeters' ? weekTotal.toFixed(2) : weekTotal.toLocaleString()} <Text style={{ fontSize: 15, color: colors.muted }}>{metric === 'distanceMeters' ? 'km run' : metric}</Text></Text>
      <View style={ui.row}>{(Object.keys(metricNames) as Metric[]).map((m) => <View key={m} style={ui.flex}><Button compact secondary={m !== metric} label={metricNames[m]} onPress={() => setMetric(m)} /></View>)}</View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 5, paddingTop: 12 }}>{data.history.map((d) => {
        const value = metricValue(d, metric);
        const isSelected = d.day === day.day;
        return <Pressable key={d.day} accessibilityRole="button" accessibilityLabel={`${d.day}: ${value} ${metricNames[metric]}`} accessibilityState={{ selected: isSelected }} onPress={() => setSelected(d.day)}
          style={{ flex: 1, alignItems: 'center', gap: 8, paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: isSelected ? colors.green : 'transparent' }}>
          <View style={{ height: 130, width: '100%', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}><Text style={{ color: isSelected ? colors.green : colors.muted, fontSize: 10 }}>{shortNumber(value)}</Text><View style={{ width: '65%', minWidth: 10, height: Math.max(2, value / max * 100), backgroundColor: isSelected ? colors.green : '#526b55', borderTopLeftRadius: 5, borderTopRightRadius: 5 }} /></View>
          <Text style={{ color: isSelected ? colors.text : colors.muted, fontSize: 10 }}>{new Date(dayStart(d.day)).toLocaleDateString(undefined, { weekday: 'narrow' })}</Text>
          <Text style={{ color: colors.muted, fontSize: 10 }}>{new Date(dayStart(d.day)).getDate()}</Text>
        </Pressable>;
      })}</View>
      <Text style={ui.small}>Tap a day to explore it. Empty days stay visible; your history never resets with your game bonuses.</Text>
    </Card>

    <View style={{ gap: 14 }}>
      <Text style={ui.heading}>{day.day === data.today.day ? 'Today' : new Date(dayStart(day.day)).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} in detail</Text>
      <Card>
        <Detail label="Completed pushups" value={day.pushups.toLocaleString()} />
        <Detail label="Shallow reps" value={day.partialReps.toLocaleString()} />
        <Detail label="Total steps · phone / recorded runs" value={day.steps.toLocaleString()} />
        <Detail label="Running steps · included in total" value={day.runningSteps.toLocaleString()} />
        <View style={ui.divider} />
        <Detail label="Distance run" value={`${(day.distanceMeters / 1000).toFixed(2)} km`} />
        <Detail label="Running dodge that day" value={percentLabel(day.agilityBps)} />
        <Detail label="Running time" value={`${Math.round(day.durationSeconds / 60)} min`} />
        <Detail label="Average running pace" value={`${paceLabel(day.distanceMeters, day.durationSeconds)}${day.distanceMeters ? ' /km' : ''}`} />
      </Card>
      {day.day === data.today.day && <Button secondary label="Manage connected steps" onPress={() => router.push('/health')} />}
    </View>

    <View style={{ gap: 14 }}><Text style={ui.heading}>Your runs</Text>
      {selectedRuns.length === 0 ? <Card><Text style={ui.body}>No runs saved for this day.</Text><Text style={ui.small}>Start a GPS run from camp to see distance, pace, and its effect on your hero here.</Text></Card> : selectedRuns.map((run) => <Card key={run.id}>
        <View style={ui.between}><Text style={ui.heading}>{(run.distanceMeters / 1000).toFixed(2)} km</Text><Text style={[ui.label, { color: colors.purple }]}>{run.source === 'gps' ? 'GPS recorded' : 'Legacy entry'}</Text></View>
        <Text style={ui.body}>{Math.round(run.durationSeconds / 60)} min · {paceLabel(run.distanceMeters, run.durationSeconds)} /km · {run.steps.toLocaleString()} steps</Text>
        <Text style={[ui.small, { color: colors.green }]}>+{percentLabel(runDodgeBps(run))} dodge contribution · daily total capped at 30%</Text>
        {run.recordingId && <Button secondary label="View GPS route" onPress={() => router.push({ pathname: '/run', params: { id: run.recordingId! } })} />}
        <Button compact secondary label="Delete incorrect entry" onPress={() => Alert.alert('Delete this run?', 'This removes the run from your history and recalculates daily power. Already earned game rewards stay.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => perform(() => deleteRun(db, run.id)) }])} />
      </Card>)}
    </View>

    <Card><Text style={ui.heading}>Your pushup power</Text><Detail label="Saved pushups" value={String(data.savedPushups)} /><Detail label="Damage multiplier" value={multiplierLabel(data.damageMultiplier)} /><Text style={ui.small}>Every saved full rep boosts damage. Attacks never spend pushups or subtract from your fitness history.</Text></Card>
    <View style={{ gap: 14 }}><Text style={ui.heading}>Since your first day</Text>
      <View style={ui.row}><Card style={ui.flex}><Text style={ui.label}>Total pushups</Text><Text style={ui.number}>{data.totals.pushups.toLocaleString()}</Text></Card><Card style={ui.flex}><Text style={ui.label}>Best pushup day</Text><Text style={ui.number}>{data.totals.bestPushupDay.toLocaleString()}</Text></Card></View>
      <Card><Detail label="Distance run, all time" value={`${(data.totals.distanceMeters / 1000).toFixed(2)} km`} /><Detail label="Runs completed" value={data.totals.runs.toLocaleString()} /><Text style={ui.small}>Your exercise data and game progress are saved on this phone. No account or internet needed.</Text></Card>
    </View>
  </Screen>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <View style={ui.between}><Text style={[ui.body, ui.flex]}>{label}</Text><Text style={{ color: colors.text, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{value}</Text></View>;
}
