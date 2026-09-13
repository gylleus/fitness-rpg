import { Canvas, useImage, type SkImage } from '@shopify/react-native-skia';
import { View } from 'react-native';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { spriteCatalog, spriteImages } from '../sprites/generated';
import { spriteGeometry } from '../sprites/playback';
import { useSpritePlayback } from '../sprites/useSpritePlayback';
import { SpriteTile } from '../sprites/SpriteTile';
import type { SpriteClip, SpriteEntity } from '../sprites/types';
import { PixelSprite } from './PixelSprite';

type Props = {
  entityId?: string;
  action?: string;
  eventKey?: string | number;
  playing?: boolean;
  speed?: number;
  /** Reference adventurer height; entity height_scale is applied automatically. */
  heroHeight?: number;
  facing?: 'left' | 'right';
  durationMs?: number;
  fallback?: ComponentProps<typeof PixelSprite>['kind'];
  tint?: string;
};

function Fallback({ heroHeight = 96, facing, fallback = 'hero', tint }: Props) {
  return <View style={{ position: 'absolute', left: -heroHeight / 2, bottom: 0 }}>
    <PixelSprite kind={fallback} size={heroHeight} tint={tint} flip={facing === 'left'} />
  </View>;
}

// Decode every action ahead of time without giving each one a native surface.
function PreloadSheet({ clip, onLoad }: {
  clip: SpriteClip; onLoad: (key: string, image: SkImage) => void;
}) {
  const image = useImage(spriteImages[clip.image]);
  useEffect(() => { if (image) onLoad(clip.image, image); }, [clip.image, image, onLoad]);
  return null;
}

function Playback({ entity, entityId, action = 'idle', eventKey, playing = true, speed = 1, heroHeight = 96, facing, durationMs, ...props }: Props & { entity: SpriteEntity }) {
  const pose = useSpritePlayback(entity, action, eventKey, playing, speed, durationMs);
  const [images, setImages] = useState<Record<string, SkImage>>({});
  const onLoad = useCallback((key: string, image: SkImage) => {
    setImages(current => current[key] === image ? current : { ...current, [key]: image });
  }, []);
  const { width, height, scale, left, top, flipped } = spriteGeometry(entity, heroHeight, facing);
  const readyClip = images[pose.clip.image] ? pose.clip : Object.values(entity.actions).find(clip => images[clip.image]);
  const image = readyClip && images[readyClip.image];
  const frame = readyClip === pose.clip ? pose.frame : readyClip?.frames[0];
  return <View testID={`entity-sprite-${entityId}`} accessible={false} pointerEvents="none" style={{ width: 0, height: 0 }}>
    {Object.values(entity.actions).map(clip => <PreloadSheet key={clip.image} clip={clip} onLoad={onLoad} />)}
    {/* One persistent native surface: transitions only replace drawing data. */}
    <Canvas testID="entity-sprite-canvas" pointerEvents="none" style={{ position: 'absolute', width, height, left, top }}>
      {image && frame && <SpriteTile image={image} frame={frame} frameSize={entity.frameSize} scale={scale} flipped={flipped} />}
    </Canvas>
    {!image && <Fallback {...props} heroHeight={heroHeight} facing={facing} />}
  </View>;
}

/** Place at the feet, not the top-left. Unknown assets use the existing icon. */
export function EntitySprite({ entityId, ...props }: Props) {
  const entity = entityId ? spriteCatalog.entities[entityId] : undefined;
  return entity ? <Playback key={entityId} entityId={entityId} entity={entity} {...props} /> : <Fallback {...props} />;
}
