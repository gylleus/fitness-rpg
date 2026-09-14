import { useCallback, useEffect, useMemo, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import { battleDungeon, type BattleState } from '../game/combat';
import { enemyAnimation, heroAnimation, journeyLeg, journeyTarget } from '../sprites/battleAnimation';
import { spriteCatalog } from '../sprites/generated';
import { playerSpriteId } from '../sprites/player';
import { usePlaybackAnimation } from '../sprites/usePlaybackAnimation';
import { EntitySprite } from './EntitySprite';
import { FloatingDamage, type FloatingImpact } from './FloatingDamage';
import { colors } from './theme';
import { WetlandsBackdrop } from '../scenes/WetlandsBackdrop';
import { hasWetlandsScenery } from '../scenes/wetlands';
import { InteriorLocationBackdrop } from '../scenes/InteriorLocationBackdrop';
import { journeyInterior } from '../scenes/interiorRoutes';

/** The hero advances in world coordinates; a following camera reveals the path. */
export function DungeonJourney({ battle, playing, speed, fullScreen = false }: { battle: BattleState; playing: boolean; speed: number; fullScreen?: boolean }) {
  const [width, setWidth] = useState(300);
  const [height, setHeight] = useState(240);
  const heroEntityId = playerSpriteId(battle.weaponType);
  const heroHeight = fullScreen ? Math.min(140, Math.max(64, (height - 160) * 0.55)) : 92;
  const leg = journeyLeg(battle);
  const moving = playing && battle.status === 'active';
  const position = usePlaybackAnimation(leg.key, leg.duration, playing && leg.walking, speed,
    leg.duration * leg.fraction, undefined, { from: leg.from, to: leg.to });
  const [strike] = useState(() => new Animated.Value(0));
  const [effects, setEffects] = useState<{ tick: number; impacts: FloatingImpact[] }>(() => ({ tick: battle.tick, impacts: [] }));
  const finishImpact = useCallback((id: string) => setEffects(current => ({ ...current, impacts: current.impacts.filter(impact => impact.id !== id) })), []);
  const dungeon = battleDungeon(battle);
  const atChest = battle.phase === 'chest' || battle.phase === 'chest-reveal';
  const wetlands = hasWetlandsScenery(dungeon);
  const interior = journeyInterior(battle);
  const groundY = height - (fullScreen ? 90 : 42);
  const worldWidth = (dungeon.enemies.length + 1) * 320 + 320;
  // Remember the incoming tick during render so fresh effects appear together
  // with the hit. Loading a saved tick never replays its old damage numbers.
  if (effects.tick !== battle.tick) {
    const hits = (battle.impacts ?? []).map((impact, index) => {
      const entityId = impact.target === 'hero' ? heroEntityId : dungeon.enemies[impact.encounter].id;
      return { ...impact, id: `${battle.tick}:${index}`,
        x: impact.target === 'hero' ? journeyTarget(battle) : 40 + (impact.encounter + 1) * 320,
        height: heroHeight * (entityId ? spriteCatalog.entities[entityId]?.heightScale ?? 1 : 1) };
    });
    setEffects({ tick: battle.tick, impacts: [...effects.impacts, ...hits] });
  }
  useEffect(() => {
    if (!moving || battle.phase !== 'fighting') return;
    strike.setValue(battle.lastAction === 'attack' ? 18 : battle.lastAction === 'dodge' ? -22 : -8);
    const animation = Animated.timing(strike, { toValue: 0, duration: 220 / speed, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [battle.tick, battle.phase, battle.lastAction, moving, strike, speed]);
  const camera = useMemo(() => Animated.multiply(Animated.subtract(position, width * 0.22), -1), [position, width]);
  const parallax = useMemo(() => Animated.multiply(camera, 0.3), [camera]);
  const heroPosition = useMemo(() => Animated.add(position, strike), [position, strike]);
  return <View onLayout={e => { setWidth(e.nativeEvent.layout.width); setHeight(e.nativeEvent.layout.height); }} accessibilityLabel={atChest ? 'Your hero waits beside a chest' : battle.phase === 'travelling' ? 'Your hero walks right through the dungeon' : 'Your hero attacks the enemy on the path'}
    style={{ height: fullScreen ? '100%' : 240, width: '100%', overflow: 'hidden', borderRadius: fullScreen ? 0 : 16, backgroundColor: '#111e22' }}>
    {wetlands ? <WetlandsBackdrop width={width} height={height} groundY={groundY} heroHeight={heroHeight}
      position={position} initialPosition={journeyTarget(battle)} seed={battle.rng?.seed ?? dungeon.id} /> : interior ?
      <InteriorLocationBackdrop location={interior} width={width} height={height} groundY={groundY} heroHeight={heroHeight}
      position={position} initialPosition={journeyTarget(battle)} seed={battle.rng?.seed ?? dungeon.id} /> : <>
    <View style={{ position: 'absolute', top: 24, right: 30, width: 33, height: 33, borderRadius: 20, backgroundColor: dungeon.color, opacity: 0.5 }} />
    <Animated.View style={{ position: 'absolute', bottom: fullScreen ? 90 : 42, width: 2400, height: 190, transform: [{ translateX: parallax }] }}>
      {Array.from({ length: 18 }, (_, i) => <View key={i} style={{ position: 'absolute', left: i * 130 - 80, bottom: 0, height: 100 + i % 3 * 28, width: 66, backgroundColor: i % 2 ? '#23382e' : '#1b302b', borderTopLeftRadius: 40, borderTopRightRadius: 40, opacity: 0.8 }} />)}
    </Animated.View>
    <View style={{ position: 'absolute', bottom: 0, height: fullScreen ? 92 : 44, width: '100%', backgroundColor: '#2c4032', borderTopWidth: 5, borderColor: '#56704a' }} />
    </>}
    <Animated.View testID="dungeon-world" style={{ position: 'absolute', bottom: fullScreen ? 70 : 22, width: worldWidth, height: 170, transform: [{ translateX: camera }] }}>
      {!wetlands && !interior && Array.from({ length: Math.ceil(worldWidth / 55) }, (_, i) => <View key={`stone-${i}`} style={{ position: 'absolute', bottom: 3, left: i * 55, width: 18, height: 4, backgroundColor: '#627050', opacity: 0.55 }} />)}
      {dungeon.enemies.map((enemy, i) => <View key={`${enemy.id ?? enemy.name}-${i}`} style={{ position: 'absolute', left: 40 + (i + 1) * 320, bottom: 20, opacity: i < battle.defeated - 1 ? 0.3 : 1 }}>
        {dungeon.chestEncounters?.includes(i) ? <View accessibilityLabel="Treasure chest" testID={`dungeon-chest-${i}`}
          style={{ width: 50, height: 38, marginLeft: -25, backgroundColor: '#70462e', borderWidth: 3, borderColor: '#dbb965', borderRadius: 5 }}>
          <View style={{ top: 10, height: 3, backgroundColor: '#dbb965' }} />
          <View style={{ position: 'absolute', left: 19, top: 9, width: 7, height: 12, backgroundColor: '#f2ce79' }} />
        </View> : <>
          {!fullScreen && <Text style={{ position: 'absolute', bottom: 133, left: -70, width: 140, color: dungeon.color, fontSize: 10, textAlign: 'center' }}>{i === dungeon.enemies.length - 1 ? 'BOSS · ' : ''}{enemy.name}</Text>}
          <EntitySprite entityId={enemy.id} {...enemyAnimation(battle, i)} heroHeight={heroHeight} facing="left" playing={playing} speed={speed} fallback={enemy.sprite} tint={dungeon.color} />
        </>}
      </View>)}
      <Animated.View style={{ position: 'absolute', bottom: 20, transform: [{ translateX: heroPosition }] }}>
        <EntitySprite entityId={heroEntityId} {...heroAnimation(battle)} heroHeight={heroHeight} facing="right" playing={playing} speed={speed} />
      </Animated.View>
      {effects.impacts.map(impact => <FloatingDamage key={impact.id} impact={impact} playing={playing} speed={speed} onComplete={finishImpact} />)}
    </Animated.View>
    {!fullScreen && <Text style={{ position: 'absolute', top: 14, left: 14, color: battle.lastAction === 'dodge' ? colors.purple : colors.text, fontSize: 11, fontWeight: '700' }}>{battle.status === 'active' ? atChest ? 'TREASURE CHEST' : battle.phase === 'travelling' ? 'ONWARD →' : battle.lastAction === 'dodge' ? 'DODGE · MISS' : 'ENEMY ENCOUNTER' : battle.status.toUpperCase()}</Text>}
  </View>;
}
