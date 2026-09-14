import { afterEach, expect, it } from '@jest/globals';
import { cleanup, render } from '@testing-library/react-native';
import { beginBattle } from '../../src/game/combat';
import { fitnessDay, heroStats } from '../../src/game/rules';
import { DungeonJourney } from '../../src/ui/DungeonJourney';

afterEach(cleanup);
const stats = heroStats({ gold: 0, xp: 0, swordLevel: 0, armorLevel: 0, unlockedDungeon: 3 }, fitnessDay('2026-09-14'));

it.each<[number, string, string]>([[1, 'lava-caves', 'crypts'], [2, 'frost-caves', 'fortress']])(
  'mounts both generated sections of chapter %i in the real journey component', async (id, first, second) => {
    const battle = beginBattle(id, '2026-09-14', stats);
    const view = await render(<DungeonJourney battle={battle} playing={false} speed={1} fullScreen />);
    expect(view.getByTestId(`${first}-scenery`)).toBeTruthy();
    expect(view.getAllByTestId('native-scene-shader')).toHaveLength(4); // Three depth/roof layers and the walking floor.
    expect(view.getAllByTestId('native-sprite-atlas').length).toBeGreaterThanOrEqual(2); // Props and the player.
    const saved = JSON.parse(JSON.stringify(battle));
    delete saved.dungeon.biomeId;
    await view.rerender(<DungeonJourney battle={{ ...saved, encounter: 2 }} playing={false} speed={1} fullScreen />);
    expect(view.queryByTestId(`${first}-scenery`)).toBeNull();
    expect(view.getByTestId(`${second}-scenery`)).toBeTruthy();
    expect(view.getAllByTestId('native-scene-shader')).toHaveLength(4);
    await view.rerender(<DungeonJourney battle={{ ...saved, encounter: 3, dungeon: undefined }} playing={false} speed={1} />);
    expect(view.getByTestId(`${second}-scenery`)).toBeTruthy();
  },
);
