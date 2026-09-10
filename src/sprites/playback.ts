import type { SpriteClip, SpriteEntity } from './types';

export function clipFor(entity: SpriteEntity, action: string) {
  return entity.actions[action] ?? entity.actions.idle ?? entity.actions.reference ?? Object.values(entity.actions)[0];
}

/** Unequal frame holds remain authoritative; a one-shot clamps to its last pose. */
export function frameAt(clip: SpriteClip, elapsed: number) {
  const time = clip.loop ? Math.max(0, elapsed) % clip.duration : Math.min(Math.max(0, elapsed), clip.duration);
  let boundary = 0;
  for (let index = 0; index < clip.frames.length; index++) {
    boundary += clip.frames[index].duration;
    if (time < boundary) return { index, frame: clip.frames[index], remaining: boundary - time };
  }
  const index = clip.frames.length - 1;
  return { index, frame: clip.frames[index], remaining: Infinity };
}

/** Attack returns to idle; arbitrary other one-shots (including death) hold. */
export function sampleSprite(entity: SpriteEntity, action: string, elapsed: number, durationMs?: number) {
  let clip = clipFor(entity, action);
  const duration = durationMs && durationMs > 0 ? durationMs : clip.duration;
  let time = elapsed;
  let ratio = clip.duration / duration;
  if (action === 'attack' && entity.actions.attack === clip && !clip.loop && elapsed >= duration && entity.actions.idle) {
    clip = entity.actions.idle;
    time -= duration;
    ratio = 1;
  }
  const pose = frameAt(clip, time * ratio);
  // The final attack hold ends at the transition to idle, not infinity.
  const remaining = !clip.loop && action === 'attack' && elapsed < duration
    ? Math.min(pose.remaining / ratio, duration - elapsed) : pose.remaining / ratio;
  return { clip, ...pose, remaining };
}

/** Canvas placement is relative to a ground point, including mirrored pivots. */
export function spriteGeometry(entity: SpriteEntity, heroHeight: number, facing = entity.facing) {
  const scale = heroHeight * entity.heightScale / entity.idleHeight;
  const width = entity.frameSize[0] * scale, height = entity.frameSize[1] * scale;
  const flipped = facing !== entity.facing;
  return { scale, width, height, flipped,
    left: -(flipped ? 1 - entity.pivot[0] : entity.pivot[0]) * width,
    top: -entity.pivot[1] * height };
}
