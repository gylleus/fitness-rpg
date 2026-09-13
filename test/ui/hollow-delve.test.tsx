import { afterEach, expect, it, jest } from '@jest/globals';
import { act, cleanup, render } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { HollowDelveBackdrop } from '../../src/scenes/HollowDelveBackdrop';
import { DungeonJourney } from '../../src/ui/DungeonJourney';
import { beginBattle, battleTurn } from '../../src/game/combat';
import { fitnessDay, heroStats } from '../../src/game/rules';

afterEach(async () => { await cleanup(); jest.restoreAllMocks(); });

it('follows travel without restarting at a saved checkpoint or resize', async () => {
  const position = new Animated.Value(600);
  const subscribe = jest.spyOn(position, 'addListener');
  const remove = jest.spyOn(position, 'removeListener');
  const props = { width: 390, height: 844, groundY: 754, heroHeight: 140, position, initialPosition: 600 };
  const view = await render(<HollowDelveBackdrop {...props} />);
  const groundX = () => view.getAllByTestId('native-scene-shader')[3].props.rect.value.x;
  expect(groundX()).toBe(390 * 0.22 - 600);
  const atlas = () => view.getByTestId('native-sprite-atlas');
  const initialTransforms = atlas().props.transforms.value;
  expect(initialTransforms.length).toBeGreaterThan(0);
  await act(() => { position.setValue(650); });
  expect(atlas().props.transforms.value).not.toEqual(initialTransforms);
  const movedTransforms = atlas().props.transforms.value;
  await view.rerender(<HollowDelveBackdrop {...props} initialPosition={610} />);
  expect(groundX()).toBe(390 * 0.22 - 650);
  expect(atlas().props.transforms.value).toEqual(movedTransforms);
  expect(atlas().props.sprites.value).toHaveLength(movedTransforms.length);
  await view.rerender(<HollowDelveBackdrop {...props} width={844} initialPosition={610} />);
  expect(groundX()).toBe(844 * 0.22 - 650);
  expect(subscribe).toHaveBeenCalledTimes(1);
  await view.unmount();
  expect(remove).toHaveBeenCalledWith(subscribe.mock.results[0].value);
});

it('mounts Hollow Delve for saved and new runs, retains it through playback, and uses all five enemy atlases', async () => {
  const stats = heroStats({ gold: 0, xp: 0, swordLevel: 0, armorLevel: 0, unlockedDungeon: 3 }, fitnessDay('2026-09-13'));
  const battle = JSON.parse(JSON.stringify(beginBattle(3, '2026-09-13', stats)));
  const view = await render(<DungeonJourney battle={battle} playing={false} speed={1} />);
  const canvas = view.getByTestId('hollow-delve-scenery');
  expect(view.getAllByTestId('native-sprite-atlas')).toHaveLength(7); // Six actors and one shared prop atlas.
  expect(view.queryByTestId('wetlands-scenery')).toBeNull();
  await view.rerender(<DungeonJourney battle={battleTurn(battle)} playing={false} speed={2} fullScreen />);
  expect(view.getByTestId('hollow-delve-scenery')).toBe(canvas);
  await view.rerender(<DungeonJourney battle={beginBattle(1, '2026-09-13', stats)} playing={false} speed={1} />);
  expect(view.queryByTestId('hollow-delve-scenery')).toBeNull();
});
