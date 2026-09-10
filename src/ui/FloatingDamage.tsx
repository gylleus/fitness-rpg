import { useCallback } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';
import type { BattleImpact } from '../game/combat';
import { ENEMY_ATTACK_IMPACT_MS, HERO_ATTACK_IMPACT_MS } from '../sprites/battleAnimation';
import { usePlaybackAnimation } from '../sprites/usePlaybackAnimation';

export type FloatingImpact = BattleImpact & { id: string; x: number; height: number };

export function FloatingDamage({ impact, playing, speed, onComplete }: {
  impact: FloatingImpact; playing: boolean; speed: number; onComplete: (id: string) => void;
}) {
  const complete = useCallback(() => onComplete(impact.id), [impact.id, onComplete]);
  const delay = impact.target === 'enemy' || impact.kind === 'heal' ? HERO_ATTACK_IMPACT_MS : ENEMY_ATTACK_IMPACT_MS;
  const DURATION = delay + 950;
  const HIT = delay / DURATION;
  const progress = usePlaybackAnimation(impact.id, DURATION, playing, speed, 0, complete);
  const color = impact.kind === 'miss' ? '#d4ecfa' : impact.kind === 'heal' ? '#b8ed93'
    : impact.target === 'hero' ? '#ff9292' : impact.critical ? '#fff1bd' : '#ffcf70';
  const label = impact.kind === 'miss' ? 'MISS' : `${impact.kind === 'heal' ? '+' : '−'}${impact.amount}`;
  return <View pointerEvents="none" style={[styles.anchor, { left: impact.x - 70, bottom: 20 + impact.height * 0.9 }]}>
    <Animated.Text testID="floating-damage" accessibilityLabel={impact.kind === 'miss' ? 'Miss' : `${impact.amount} ${impact.kind} to ${impact.target}`}
      style={[styles.text, { color, fontSize: impact.critical ? 34 : 27,
        opacity: progress.interpolate({ inputRange: [0, HIT, HIT + 0.025, 0.72, 1], outputRange: [0, 0, 1, 1, 0] }),
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, HIT, HIT + 0.1, 0.7, 1], outputRange: [0, 0, -12, -34, -60] }) },
          { translateX: progress.interpolate({ inputRange: [0, HIT, 1], outputRange: [0, 0, impact.target === 'hero' ? -14 : 14] }) },
          { scale: progress.interpolate({ inputRange: [0, HIT, HIT + 0.07, HIT + 0.18, 1], outputRange: [0.55, 0.55, 1.28, 1, 0.94] }) },
        ],
      }]}>{impact.critical ? `${label}!` : label}</Animated.Text>
  </View>;
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', width: 140, alignItems: 'center' },
  text: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontWeight: '900', textAlign: 'center',
    textShadowColor: '#101719', textShadowOffset: { width: 2, height: 3 }, textShadowRadius: 2 },
});
