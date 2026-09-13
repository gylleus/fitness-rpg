# Dungeon selection map

`source.png` is the selected built-in imagegen map. Its exact input is in
`prompt.txt`; `source.json` records the source hash, dimensions and runtime path.
The game bundles a byte-identical copy at `assets/maps/world-map.png`.

Four landmarks represent the existing expeditions: Wetlands in the southwest,
Embercrypt in the southeast, Frostbound Keep in the northeast, and Hollow Delve
in the northwest. A small camp marks the start of the route. This illustration
adds no new dungeons or progression rules.

`src/ui/worldMap.ts` places native touch targets and connecting curves in one
720×900 coordinate space. Coordinates were adjusted to the selected image's
actual landmark entrances. `DungeonMap.tsx` scales the image and SVG routes
together, while labels and buttons retain readable native sizes. Route and lock
states come from saved dungeon unlocks; a selected location opens its detail
card, and entry still uses the existing database checks.

The layout tests cover all four dungeon IDs, connected paths, progression and
nonoverlapping touch targets from 276–520px wide. Native screen tests cover
selection, locked prerequisites, entry into each dungeon, active expedition
continuation, zero health and unlocks after victory.

```sh
npm run test:logic -- test/world-map.test.ts
npm run test:ui -- --runTestsByPath test/ui/game-flow.test.tsx
npm run typecheck
npm run lint
```
