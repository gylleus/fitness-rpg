import { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';

/** A native animation clock that retains elapsed game time through pause/speed changes. */
export function usePlaybackAnimation(key: string, duration: number, playing: boolean, speed: number,
  initialElapsed = 0, onComplete?: () => void, range = { from: 0, to: 1 }) {
  const { from, to } = range;
  // Keep the animated value in its actual coordinate space. Rebinding a 0..1
  // value to the next leg's range can move the camera before effects reset it.
  const [value] = useState(() => new Animated.Value(from + (to - from) * initialElapsed / duration));
  const clock = useRef({ key, from, to, elapsed: initialElapsed });
  useEffect(() => {
    if (clock.current.key === key && clock.current.from === from && clock.current.to === to) return;
    clock.current = { key, from, to, elapsed: initialElapsed };
    value.setValue(from + (to - from) * initialElapsed / duration);
  }, [key, initialElapsed, duration, value, from, to]);
  useEffect(() => {
    if (!playing || speed <= 0) return;
    const current = clock.current;
    const started = Date.now();
    const animation = Animated.timing(value, {
      toValue: to, duration: Math.max(0, duration - current.elapsed) / speed,
      easing: Easing.linear, useNativeDriver: true, isInteraction: false,
    });
    animation.start(({ finished }) => { if (finished) onComplete?.(); });
    return () => {
      current.elapsed = Math.min(duration, current.elapsed + (Date.now() - started) * speed);
      animation.stop();
      value.setValue(from + (to - from) * current.elapsed / duration);
    };
  }, [key, duration, playing, speed, value, onComplete, from, to]);
  return value;
}
