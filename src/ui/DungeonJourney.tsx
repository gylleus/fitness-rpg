import { useEffect, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import { DUNGEONS, type BattleState } from '../game/combat';
import { PixelSprite } from './PixelSprite';
import { colors } from './theme';

/** The hero advances in world coordinates; a following camera reveals the path. */
export function DungeonJourney({ battle, moving, speed }: { battle: BattleState; moving: boolean; speed: number }) {
  const [width, setWidth] = useState(300);
  const target = 40 + battle.encounter * 320 + (battle.travel ?? 3) / 3 * 240;
  const [position] = useState(() => new Animated.Value(target));
  const [bob] = useState(() => new Animated.Value(0));
  const [strike] = useState(() => new Animated.Value(0));
  const dungeon = DUNGEONS[battle.dungeonId];
  useEffect(() => {
    const animation = Animated.timing(position, { toValue: target, duration: moving ? 450 / speed : 0, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [position, target, moving, speed]);
  useEffect(() => {
    if (!moving || battle.phase !== 'travelling') { bob.setValue(0); return; }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: -6, duration: 140 / speed, useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 140 / speed, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [battle.phase, moving, speed, bob]);
  useEffect(() => {
    if (!moving || battle.phase !== 'fighting') return;
    strike.setValue(battle.lastAction === 'attack' ? 18 : battle.lastAction === 'dodge' ? -22 : -8);
    const animation = Animated.timing(strike, { toValue: 0, duration: 220 / speed, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [battle.tick, battle.phase, battle.lastAction, moving, strike, speed]);
  const camera = Animated.multiply(Animated.subtract(position, width * 0.22), -1);
  return <View onLayout={e => setWidth(e.nativeEvent.layout.width)} accessibilityLabel={battle.phase === 'travelling' ? 'Your hero walks right through the dungeon' : 'Your hero attacks the enemy on the path'}
    style={{ height: 240, overflow: 'hidden', borderRadius: 16, backgroundColor: '#111e22' }}>
    <View style={{ position: 'absolute', top: 24, right: 30, width: 33, height: 33, borderRadius: 20, backgroundColor: dungeon.color, opacity: 0.5 }} />
    <Animated.View style={{ position: 'absolute', bottom: 42, width: 2400, height: 190, transform: [{ translateX: Animated.multiply(camera, 0.3) }] }}>
      {Array.from({ length: 18 }, (_, i) => <View key={i} style={{ position: 'absolute', left: i * 130 - 80, bottom: 0, height: 100 + i % 3 * 28, width: 66, backgroundColor: i % 2 ? '#23382e' : '#1b302b', borderTopLeftRadius: 40, borderTopRightRadius: 40, opacity: 0.8 }} />)}
    </Animated.View>
    <View style={{ position: 'absolute', bottom: 0, height: 44, width: '100%', backgroundColor: '#2c4032', borderTopWidth: 5, borderColor: '#56704a' }} />
    <Animated.View style={{ position: 'absolute', bottom: 22, width: 1800, height: 130, transform: [{ translateX: camera }] }}>
      {Array.from({ length: 32 }, (_, i) => <View key={`stone-${i}`} style={{ position: 'absolute', bottom: 3, left: i * 55, width: 18, height: 4, backgroundColor: '#627050', opacity: 0.55 }} />)}
      {dungeon.enemies.map((enemy, i) => <View key={enemy.name} style={{ position: 'absolute', left: 40 + (i + 1) * 320, bottom: 20, opacity: i < battle.defeated ? 0.15 : 1 }}>
        <Text style={{ color: dungeon.color, fontSize: 10, textAlign: 'center', marginBottom: 7 }}>{i === 3 ? 'BOSS' : enemy.name}</Text>
        <PixelSprite kind={enemy.sprite} size={i === 3 ? 104 : 80} tint={dungeon.color} flip />
      </View>)}
      <Animated.View style={{ position: 'absolute', bottom: 20, opacity: battle.heroHp === 0 ? 0.35 : 1, transform: [{ translateX: Animated.add(position, strike) }, { translateY: bob }] }}>
        <PixelSprite kind="hero" size={82} tint="#829cb4" />
      </Animated.View>
    </Animated.View>
    <Text style={{ position: 'absolute', top: 14, left: 14, color: battle.lastAction === 'dodge' ? colors.purple : colors.text, fontSize: 11, fontWeight: '700' }}>{battle.status === 'active' ? battle.phase === 'travelling' ? 'ONWARD →' : battle.lastAction === 'dodge' ? 'DODGE · MISS' : 'ENEMY ENCOUNTER' : battle.status.toUpperCase()}</Text>
  </View>;
}
