import { useEffect, useRef, useState } from 'react';
import { sampleSprite } from './playback';
import type { SpriteEntity } from './types';

/** One timeout per visible pose, no render-per-display-frame polling. */
export function useSpritePlayback(entity: SpriteEntity, action: string, eventKey: string | number | undefined,
  playing: boolean, speed: number, durationMs?: number) {
  const key = `${action}:${eventKey ?? ''}`;
  const clock = useRef({ key, elapsed: 0 });
  const [state, setState] = useState(() => ({ key, pose: sampleSprite(entity, action, 0, durationMs) }));
  useEffect(() => {
    if (clock.current.key !== key) clock.current = { key, elapsed: 0 };
    let last = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const rate = playing && Number.isFinite(speed) && speed > 0 ? speed : 0;
    const accumulate = () => {
      const now = Date.now();
      clock.current.elapsed += Math.max(0, now - last) * rate;
      last = now;
    };
    const tick = () => {
      accumulate();
      const pose = sampleSprite(entity, action, clock.current.elapsed, durationMs);
      setState({ key, pose });
      if (rate && Number.isFinite(pose.remaining)) timer = setTimeout(tick, Math.max(1, Math.ceil(pose.remaining / rate)));
    };
    tick();
    return () => { clearTimeout(timer); accumulate(); };
  }, [entity, action, key, playing, speed, durationMs]);
  return state.key === key ? state.pose : sampleSprite(entity, action, 0, durationMs);
}
