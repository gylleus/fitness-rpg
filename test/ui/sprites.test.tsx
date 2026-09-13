import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import { act, cleanup, render, renderHook } from '@testing-library/react-native';
import catalog from '../../assets/sprites/catalog.json';
import { useSpritePlayback } from '../../src/sprites/useSpritePlayback';
import type { SpriteCatalog } from '../../src/sprites/types';
import { EntitySprite } from '../../src/ui/EntitySprite';
import { Animated, Easing } from 'react-native';
import { usePlaybackAnimation } from '../../src/sprites/usePlaybackAnimation';
import { useBattleTick } from '../../src/sprites/useBattleTick';
import { DungeonJourney } from '../../src/ui/DungeonJourney';
import { beginBattle, battleTurn } from '../../src/game/combat';
import { fitnessDay, heroStats } from '../../src/game/rules';
import { battleSchedule, HERO_ATTACK_DURATION_MS, HERO_ATTACK_IMPACT_MS } from '../../src/sprites/battleAnimation';

const player = (catalog as unknown as SpriteCatalog).entities.barbarian_player;
beforeEach(() => { jest.useFakeTimers({ doNotFake: ['queueMicrotask'] }); jest.setSystemTime(0); });
afterEach(async () => { await cleanup(); jest.restoreAllMocks(); jest.useRealTimers(); });

it('retains the absolute position when a finished leg becomes the next encounter recovery', async () => {
  const { result, rerender } = await renderHook(
    ({ key, from, to, elapsed }: { key: string; from: number; to: number; elapsed: number }) =>
      usePlaybackAnimation(key, 1500, false, 1, elapsed, undefined, { from, to }),
    { initialProps: { key: '0:hold', from: 40, to: 280, elapsed: 1500 } });
  const position = result.current;
  const readPosition = jest.fn();
  position.stopAnimation(readPosition);
  expect(readPosition).toHaveBeenLastCalledWith(280);
  const changes: number[] = [];
  const listener = position.addListener(({ value }) => changes.push(value));
  await rerender({ key: '1:hold', from: 280, to: 600, elapsed: 0 });
  expect(result.current).toBe(position);
  expect(changes).toEqual([280]);
  position.removeListener(listener);
});

it('retains the native camera graph through a killing attack and the following walk', async () => {
  const multiply = jest.spyOn(Animated, 'multiply');
  const stats = heroStats({ gold: 0, xp: 0, swordLevel: 0, armorLevel: 0, unlockedDungeon: 0 }, fitnessDay('2026-09-11'));
  const battle = { ...beginBattle(0, '2026-09-11', stats), phase: 'fighting' as const, travel: 3, enemyHp: 1 };
  const view = await render(<DungeonJourney battle={battle} playing={false} speed={1} />);
  const cameraBuilds = () => multiply.mock.calls.filter(([, multiplier]) => multiplier === -1).length;
  expect(cameraBuilds()).toBe(1);
  const kill = battleTurn(battle);
  await view.rerender(<DungeonJourney battle={kill} playing={false} speed={1} />);
  expect(cameraBuilds()).toBe(1);
  await view.rerender(<DungeonJourney battle={battleTurn(kill)} playing={false} speed={1} />);
  expect(cameraBuilds()).toBe(1);
});

it('runs one native linear movement across travel checkpoints and resumes the unfinished distance', async () => {
  const timing = jest.spyOn(Animated, 'timing');
  const { rerender, unmount } = await renderHook(
    ({ checkpoint, playing, speed }: { checkpoint: number; playing: boolean; speed: number }) =>
      usePlaybackAnimation('leg-0', 1500, playing, speed, checkpoint * 500),
    { initialProps: { checkpoint: 0, playing: true, speed: 1 } });
  await act(() => { jest.advanceTimersByTime(500); });
  await rerender({ checkpoint: 1, playing: true, speed: 1 });
  expect(timing).toHaveBeenCalledTimes(1);
  expect(timing.mock.calls[0][1]).toMatchObject({ duration: 1500, easing: Easing.linear, useNativeDriver: true });
  await act(() => { jest.advanceTimersByTime(150); });
  await rerender({ checkpoint: 1, playing: false, speed: 1 });
  await act(() => { jest.advanceTimersByTime(5000); });
  await rerender({ checkpoint: 1, playing: true, speed: 2 });
  expect(timing).toHaveBeenCalledTimes(2);
  expect(timing.mock.calls[1][1].duration).toBe(425);
  await unmount();
  // Flush the native bridge cleanup; no animation may schedule another frame.
  await act(() => { jest.runOnlyPendingTimers(); });
  expect(jest.getTimerCount()).toBe(0);
});

it('keeps combat checkpoint time synchronized when pausing and changing speed mid-step', async () => {
  const advance = jest.fn();
  const { rerender, unmount } = await renderHook(
    ({ tick, playing, speed }: { tick: number; playing: boolean; speed: number }) =>
      useBattleTick(`run-1:${tick}`, 500, playing, speed, advance),
    { initialProps: { tick: 0, playing: true, speed: 1 } });
  await act(() => { jest.advanceTimersByTime(200); });
  await rerender({ tick: 0, playing: false, speed: 1 });
  await act(() => { jest.advanceTimersByTime(5000); });
  expect(advance).not.toHaveBeenCalled();
  await rerender({ tick: 0, playing: true, speed: 2 });
  await act(() => { jest.advanceTimersByTime(149); });
  expect(advance).not.toHaveBeenCalled();
  await act(() => { jest.advanceTimersByTime(1); });
  expect(advance).toHaveBeenCalledTimes(1);
  await rerender({ tick: 1, playing: true, speed: 2 });
  await act(() => { jest.advanceTimersByTime(250); });
  expect(advance).toHaveBeenCalledTimes(2);
  await unmount();
  expect(jest.getTimerCount()).toBe(0);
});

it('attacks at the walk deadline even when saving and rendering each checkpoint is slow', async () => {
  const stats = heroStats({ gold: 0, xp: 0, swordLevel: 0, armorLevel: 0, unlockedDungeon: 0 }, fitnessDay('2026-09-11'));
  let battle = beginBattle(0, '2026-09-11', stats);
  const advance = jest.fn(() => { battle = battleTurn(battle); });
  const { rerender } = await renderHook(({ state }: { state: typeof battle }) => {
    const schedule = battleSchedule(state);
    useBattleTick(schedule.key, schedule.deadline, true, 1, advance, schedule.elapsed);
  }, { initialProps: { state: battle } });
  await act(() => { jest.advanceTimersByTime(500); });
  expect(battle.travel).toBe(1);
  // Native walking keeps moving during a delayed save/render.
  await act(() => { jest.advanceTimersByTime(180); });
  await rerender({ state: battle });
  await act(() => { jest.advanceTimersByTime(320); });
  expect(battle.travel).toBe(2);
  await act(() => { jest.advanceTimersByTime(190); });
  await rerender({ state: battle });
  await act(() => { jest.advanceTimersByTime(309); });
  expect(battle.attacksMade).toBe(0);
  await act(() => { jest.advanceTimersByTime(1); });
  expect(Date.now()).toBe(1500);
  expect(battle).toMatchObject({ lastAction: 'attack', attacksMade: 1 });
});

it('interrupts an unfinished walk pose immediately and reaches the strike at 180 ms', async () => {
  const view = await render(<EntitySprite entityId="barbarian_player" action="walk" />);
  const canvas = view.getByTestId('entity-sprite-canvas');
  await act(() => { jest.advanceTimersByTime(35); });
  await view.rerender(<EntitySprite entityId="barbarian_player" action="attack" eventKey={1} durationMs={HERO_ATTACK_DURATION_MS} />);
  expect(view.getByTestId('entity-sprite-canvas')).toBe(canvas);
  expect(view.getByTestId('native-sprite-atlas').props.sprites[0].x).toBe(0);
  await act(() => { jest.advanceTimersByTime(HERO_ATTACK_IMPACT_MS); });
  expect(view.getByTestId('native-sprite-atlas').props.sprites[0].x).toBe(3 * 128);
});

it('shows each fresh hit once, keeps it over the defeated enemy and removes it after floating', async () => {
  const stats = heroStats({ gold: 0, xp: 0, swordLevel: 0, armorLevel: 0, unlockedDungeon: 0 }, fitnessDay('2026-09-11'));
  const battle = { ...beginBattle(0, '2026-09-11', stats), phase: 'fighting' as const, travel: 3, enemyHp: 1 };
  const hit = battleTurn(battle);
  const view = await render(<DungeonJourney battle={battle} playing speed={1} />);
  await view.rerender(<DungeonJourney battle={hit} playing speed={1} />);
  expect(view.getAllByTestId('floating-damage')).toHaveLength(1);
  expect(view.getByLabelText('25 damage to enemy')).toHaveTextContent('−25');
  await view.rerender(<DungeonJourney battle={{ ...hit }} playing={false} speed={1} />);
  await act(() => { jest.advanceTimersByTime(5000); });
  expect(view.getAllByTestId('floating-damage')).toHaveLength(1);
  await view.rerender(<DungeonJourney battle={hit} playing speed={2} />);
  await act(() => { jest.advanceTimersByTime(1500); });
  expect(view.queryAllByTestId('floating-damage')).toHaveLength(0);
  await view.unmount();
  const restored = await render(<DungeonJourney battle={JSON.parse(JSON.stringify(hit))} playing speed={1} />);
  expect(restored.queryAllByTestId('floating-damage')).toHaveLength(0);
});

it('freezes while paused, resumes remaining hold, changes speed, restarts repeated attacks and cleans up', async () => {
  const { result, rerender, unmount } = await renderHook(
    ({ playing, speed, event }: { playing: boolean; speed: number; event: number }) =>
      useSpritePlayback(player, 'attack', event, playing, speed, 800),
    { initialProps: { playing: true, speed: 1, event: 1 } });
  await act(() => { jest.advanceTimersByTime(150); });
  expect(result.current.index).toBe(1);
  await rerender({ playing: false, speed: 1, event: 1 });
  await act(() => { jest.advanceTimersByTime(5000); });
  expect(result.current.index).toBe(1);
  expect(jest.getTimerCount()).toBe(0);
  await rerender({ playing: true, speed: 2, event: 1 });
  await act(() => { jest.advanceTimersByTime(64); });
  expect(result.current.index).toBe(1);
  await act(() => { jest.advanceTimersByTime(1); });
  expect(result.current.index).toBe(2);
  await act(() => { jest.advanceTimersByTime(300); });
  expect(result.current.clip).toBe(player.actions.idle);
  await rerender({ playing: true, speed: 2, event: 2 });
  expect(result.current.index).toBe(0);
  expect(result.current.clip).toBe(player.actions.attack);
  await unmount();
  expect(jest.getTimerCount()).toBe(0);
});

it('finishes death while the battle is terminal and never loops it', async () => {
  const { result } = await renderHook(() => useSpritePlayback(player, 'death', undefined, true, 1, 800));
  await act(() => { jest.advanceTimersByTime(10000); });
  expect(result.current.index).toBe(5);
  expect(result.current.clip).toBe(player.actions.death);
  expect(jest.getTimerCount()).toBe(0);
});

it('passes one selected tile and nearest sampling to the native atlas boundary', async () => {
  const view = await render(<EntitySprite entityId="barbarian_player" action="idle" playing={false} />);
  const atlas = view.getByTestId('native-sprite-atlas');
  expect(atlas.props.sprites).toEqual([{ x: 0, y: 0, width: 128, height: 128 }]);
  expect(atlas.props.sampling).toEqual({ filter: 0, mipmap: 0 });
  expect(atlas.props.transforms).toHaveLength(1);
  await view.rerender(<EntitySprite entityId="future_enemy" fallback="slime" playing={false} />);
  expect(view.queryByTestId('native-sprite-atlas')).toBeNull();
});

it('keeps the same native canvas through loop boundaries, action changes, and attack recovery', async () => {
  const view = await render(<EntitySprite entityId="barbarian_player" action="idle" />);
  const canvas = view.getByTestId('entity-sprite-canvas');
  for (const elapsed of [player.actions.idle.duration - 1, 1, 1]) {
    await act(() => { jest.advanceTimersByTime(elapsed); });
    expect(view.getByTestId('entity-sprite-canvas')).toBe(canvas);
    expect(view.getAllByTestId('native-sprite-atlas')).toHaveLength(1);
  }
  for (const action of ['walk', 'attack', 'idle', 'attack', 'death']) {
    await view.rerender(<EntitySprite entityId="barbarian_player" action={action} durationMs={800} />);
    expect(view.getByTestId('entity-sprite-canvas')).toBe(canvas);
    await act(() => { jest.advanceTimersByTime(801); });
    expect(view.getByTestId('entity-sprite-canvas')).toBe(canvas);
    expect(view.getAllByTestId('native-sprite-atlas')).toHaveLength(1);
  }
});
