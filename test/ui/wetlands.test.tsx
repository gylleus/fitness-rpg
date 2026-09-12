import { afterEach, expect, it, jest } from '@jest/globals';
import { act, cleanup, render } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { WetlandsBackdrop } from '../../src/scenes/WetlandsBackdrop';
import { DungeonJourney } from '../../src/ui/DungeonJourney';
import { beginBattle, battleTurn } from '../../src/game/combat';
import { fitnessDay, heroStats } from '../../src/game/rules';

afterEach(async () => { await cleanup(); jest.restoreAllMocks(); });

it('follows the existing position, retains it across checkpoints and resize, and removes its subscription', async () => {
  const position = new Animated.Value(600);
  const subscribe = jest.spyOn(position, 'addListener');
  const remove = jest.spyOn(position, 'removeListener');
  const timing = jest.spyOn(Animated, 'timing');
  const props = { width: 390, height: 844, groundY: 754, heroHeight: 140, position, initialPosition: 600 };
  const view = await render(<WetlandsBackdrop {...props} />);
  const canvas = view.getByTestId('wetlands-scenery');
  const offsets = () => view.getAllByTestId('native-scene-shader').map(shader => shader.props.rect.value.x);
  const initialCamera = 390 * 0.22 - 600;
  expect(offsets()).toEqual([initialCamera * 0.15, initialCamera * 0.35, initialCamera]);
  await act(() => { position.setValue(640); });
  // A combat checkpoint can lag the native position. It must never rewind it.
  await view.rerender(<WetlandsBackdrop {...props} initialPosition={620} />);
  expect(view.getByTestId('wetlands-scenery')).toBe(canvas);
  expect(offsets()[2]).toBe(390 * 0.22 - 640);
  await view.rerender(<WetlandsBackdrop {...props} width={844} initialPosition={620} />);
  expect(offsets()[2]).toBe(844 * 0.22 - 640);
  expect(subscribe).toHaveBeenCalledTimes(1);
  expect(timing).not.toHaveBeenCalled();
  await view.unmount();
  expect(remove).toHaveBeenCalledWith(subscribe.mock.results[0].value);
});

it('mounts the art for Wetlands, keeps it through playback changes, and falls back for legacy runs', async () => {
  const stats = heroStats({ gold: 0, xp: 0, swordLevel: 0, armorLevel: 0, unlockedDungeon: 0 }, fitnessDay('2026-09-11'));
  const battle = beginBattle(0, '2026-09-11', stats);
  const view = await render(<DungeonJourney battle={battle} playing={false} speed={1} />);
  const canvas = view.getByTestId('wetlands-scenery');
  await view.rerender(<DungeonJourney battle={battleTurn(battle)} playing={false} speed={2} fullScreen />);
  expect(view.getByTestId('wetlands-scenery')).toBe(canvas);
  await view.rerender(<DungeonJourney battle={{ ...battle, dungeon: undefined }} playing={false} speed={1} />);
  expect(view.queryByTestId('wetlands-scenery')).toBeNull();
  await view.rerender(<DungeonJourney battle={beginBattle(1, '2026-09-11', stats)} playing={false} speed={1} />);
  expect(view.queryByTestId('wetlands-scenery')).toBeNull();
});
