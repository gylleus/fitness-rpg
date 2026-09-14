import { expect, test } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import palette from '../../assets/palette.json';
import { DUNGEONS } from '../../src/game/combat';
import { spriteColor } from '../../src/sprites/palette';
import { PixelSprite } from '../../src/ui/PixelSprite';

test('code-native fallback sprites keep every dungeon tint inside the master palette', async () => {
  const allowed = new Set(palette.colors);
  for (const kind of ['hero', 'knight', 'slime', 'wolf', 'boss', 'sword', 'armor'] as const) {
    for (const tint of [undefined, ...DUNGEONS.map(dungeon => dungeon.color)]) {
      const view = await render(<PixelSprite kind={kind} tint={tint} />);
      const pixels = view.root!.children.flatMap(node => typeof node === 'object' ? [StyleSheet.flatten(node.props.style)?.backgroundColor] : []).filter(Boolean);
      expect(pixels.length).toBeGreaterThan(20);
      for (const color of pixels) expect(allowed.has(String(color))).toBe(true);
      await view.unmount();
    }
  }
});

test('every exact master colour is preserved by native tint selection', () => {
  for (const color of palette.colors) expect(spriteColor(color)).toBe(color);
});
