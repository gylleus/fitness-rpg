import { useEffect, useRef } from 'react';

/** Preserve the unfinished tick so pausing cannot desynchronize walking and combat. */
export function useBattleTick(key: string, duration: number, playing: boolean, speed: number, advance: () => void, initialElapsed = 0) {
  const clock = useRef({ key, elapsed: initialElapsed });
  useEffect(() => {
    if (clock.current.key !== key) clock.current = { key, elapsed: initialElapsed };
    if (!playing || speed <= 0) return;
    const current = clock.current;
    const started = Date.now();
    const timer = setTimeout(advance, Math.max(0, duration - current.elapsed) / speed);
    return () => {
      clearTimeout(timer);
      // Saving/rendering a travel checkpoint consumes time too. Keep that
      // elapsed time so the next deadline cannot drift behind native walking.
      current.elapsed += Math.max(0, Date.now() - started) * speed;
    };
  }, [key, duration, playing, speed, advance, initialElapsed]);
}
