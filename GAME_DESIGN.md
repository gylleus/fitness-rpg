# Fitness RPG — game design

## The promise

Real effort supplies an adventurer. Save pushups, increase damage,
walk for daily health, and run for daily agility. Watch automatic dungeon battles,
then turn boss bounties into lasting gear and useful consumables. Fitness history
also shows progress outside the game; spending resources never erases exercise.
An in-game level is adventure progress, not a measurement of physical ability.

## Core loop

1. Save a pushup workout: every full rep increases your damage multiplier.
2. Sync native steps for health; record a GPS run for dodge from distance and pace.
3. Enter a dungeon. Travel right, stop at enemies, and auto-attack.
4. Attacks never consume pushups. Defeat the boss to bank gold, XP, enemy drops and a guaranteed boss item.
5. Equip found items, sell spare gear, and buy potions from Inventory → Supplies.
6. Wins carry exact remaining health into the next expedition. Failure restores
   entry health and grants zero loot. Used potion charges stay spent.

Step health, pushup damage, running agility, and daily quests reset at **5 AM
device time**. Health recovers to the new day's maximum. Workout history, gear,
gold, XP, unlocked dungeons, potions, and unused focus charges carry over.

## Character, resources, and initial balance

These are tunable game numbers, not prescribed workout targets.

| Source | Benefit | Lifetime |
| --- | --- | --- |
| Base character | 100 health; unarmed damage 5–9 | Permanent |
| Starter Wooden Club | 20–30 damage per hit | While equipped |
| Found equipment | Damage range, health, flat damage, or pushup coefficient bonus | While equipped |
| Each level after level 1 | +1 damage, +5 health | Permanent |
| Completed pushup | +10% of base damage per attack, before item bonuses | Until 5 AM device time |
| Every 100 steps today | +1 health | Until 5 AM device time |
| Running distance and pace | Agility, expressed as deterministic dodge | Until 5 AM device time |

### Pushup damage

Damage is `round(baseDamage * (1 + coefficient * todayPushups))`. The default
coefficient is `0.1` in `src/game/items.ts`; 10 pushups today doubles damage,
20 triples it. Full reps from workouts completed during the current fitness day
count. Lifetime totals remain in history. Partial reps remain in history and
do not add damage. There is no cap, spending, attack limit, or exhaustion state
for new battles. Zero pushups permits entry with the normal base damage.

Coefficient bonuses from equipment and future talents add to the base value.
The existing amulet adds `0.01`; a focus charge adds `0.02` for that swing.
Coefficients resolve in integer basis points before rounding final damage to
avoid decimal rounding errors at half-damage boundaries.

Training, gear, and the permanent coefficient are snapshotted at entry. New
workouts increase camp power immediately and apply to the next expedition;
a paused battle retains its original damage inputs. Focus charges still wear
off after ten actual attacks, so the HUD previews the next swing correctly.

### Step health and running agility

Running steps are included in total steps once. Use the maximum of the native
aggregate and recorded running steps; never sum them as separate walking totals.
Running does not multiply health. Runs with pending native step data still earn
agility from saved distance and active duration.

```
level = 1 + floor(xp / 100)
baseDamage = seededRoll(weaponMin, weaponMax) + gearDamageBonus + (level - 1)
damage = round(baseDamage * (1 + pushupDamageCoefficient * todayPushups))
dailyHealth = floor(totalSteps / 100)
health = 100 + equippedHealthBonus + (level - 1) * 5 + dailyHealth
speedKmh = distanceMeters / activeSeconds * 3.6
paceWeight = clamp(speedKmh / 8, 0.5, 1.5)
runDodgeBps = min(3000, round(distanceKm * 200 * paceWeight))
dodgeBps = min(3000, sum(runDodgeBps))
```

One basis point is 0.01%. At 8 km/h, 5 km earns 10% dodge; at 12 km/h it earns
15%. Ten kilometers at 8 km/h earns 20%. Faster paces stop increasing the weight
at 12 km/h, and total daily dodge is capped at 30%. Multiple runs use their own
pace before summing. A short sprint cannot boost an entire day's activity.

### Seeded damage, dodge and attack effects

Each dungeon has a persistent victory counter. Its seed is derived from the
dungeon ID and that counter. Defeat, retreat, expiry, pausing and app restarts
never advance it. Only victory increments it, atomically with the rewards.
Winning a different dungeon cannot reroll this one's encounters.

Weapon damage is an inclusive integer roll, followed by flat gear and level
bonuses, then the pushup multiplier. The screen shows the resulting min–max
range. Dodge and on-attack effects also use the saved combat RNG, rather than
carrying proc meters between attempts. Matching entry stats, gear, health and
focus charges replay the same outcomes. Training or changing equipment can
change the outcome; used potion charges still remain spent after failure.

The versioned RNG and current draw state are saved in every battle checkpoint.
Loot uses a separate stream per encounter, so the number of attacks or proc
rolls cannot alter drops. The full loot plan is snapshotted at entry. Existing
version-2 expeditions finish with their saved fixed-damage and meter rules;
new version-3 expeditions use seeded rolls and item rewards.

Damage resolution stays pure: roll base damage, apply pushup/focus power,
roll on-attack effects, apply the strongest triggered critical, then flat damage
and healing effects in equipment-slot order. Criticals do not multiply flat
proc damage; healing caps at max HP. Effects cannot recursively trigger attacks.
Current gear supplies damage, health and coefficient bonuses; the effect
schema supports later critical, damage and healing items.

## Time, persistence, and migration

A fitness day runs from 5 AM to the next 5 AM in the device's local timezone,
using calendar arithmetic across daylight-saving changes. Derive health, pushup
damage, and agility from that day's activity; refresh at the reset boundary and
on foreground entry. No background reset job or history deletion is needed.
Pushup sets and GPS workouts belong to the fitness day in which they finish.
Native step sync queries the same 5 AM intervals. An active dungeon expires at
the reset, dropping pending loot so it cannot retain yesterday's power. Used
potion charges stay consumed. Unused focus charges carry over; dungeon seeds
stay unchanged. Version one trusts the phone's clock; no streak penalty applies
on rest days.

Use the existing expo-sqlite + Drizzle database, offline with no new account or
backend. [Expo SDK 57 SQLite](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/).

| Data | Stored information |
| --- | --- |
| Sessions and sets | Exercise, timestamps, full/partial reps, form data |
| Activity days | Native aggregate steps, source, sync time, legacy total |
| Runs | Completion fitness day, source/key, distance, active seconds, steps, recording ID |
| Recordings and route points | Status, pause intervals, accepted GPS fixes, route gaps |
| Health connection | Explicit opt-in and last completed sync |
| Hero | Gold, XP, unlocks, daily damage, legacy fields, potions, focus charges, inventory conversion version |
| Inventory items | Unique owned item ID, immutable item snapshot, optional unique equipment slot, acquisition/source |
| Dungeon seeds | Victory counter per dungeon |
| Dungeon runs | Entry stats/roster, RNG seed/state, loot plan, focus charges, turns, combat log, pending rewards |
| Challenge claims | Unique fitness day + challenge ID |

Power counts the current fitness day's saved full pushup reps. Workout save keys prevent
duplicating a retried save. Every turn atomically saves focus, RNG state,
and its battle checkpoint. Stale callbacks do nothing, and failed saves roll
back all changes, including the final boss reward. Attacks do not change fitness
records or historical spending counters.

Migrations 0003 and 0004 preserve older stockpile history and support dismissing
finished results. Migration 0005 retires active stockpile battles without banking
pending rewards. All workouts, banked gold/XP, gear, available entry health, and
potion inventory are preserved. Historical spending no longer reduces power.
Migration 0006 adds inventory and dungeon seed storage. On first read, one
transaction converts old sword/armor levels and the owned amulet to equipped
item instances with equivalent average damage, health and coefficient bonuses.
A version flag prevents starter items from reappearing after they are sold.
Migration 0007 expires active battles that used lifetime power, preserving banked
progress and past results. It assigns existing GPS runs to their completion
fitness day; manual entries retain their chosen date. Native step aggregates
are replaced with the new intervals on the next health sync.

## Automatic dungeon battles

The hero moves right through a scrolling woodland, stopping to auto-attack each
enemy. Three saved travel steps separate encounters. The hero attacks first;
surviving enemies retaliate. Show both health bars, next-swing damage, the pushup multiplier, pending bounty,
and the latest combat event in a compact overlay. A dodge displays a miss and a backward
movement. Navigating away or backgrounding pauses the battle.

The portrait dungeon picker opens a dedicated full-screen landscape expedition.
System bars and tabs are hidden while playing; returning restores portrait and
normal navigation. The Android manifest identifies the app as a game so that
Android 16+ honors orientation requests on large foldable displays. This metadata
requires a rebuilt native client (`npx expo prebuild --platform android --no-install`).
A single native canvas per entity stays mounted across loops
and action changes to prevent whole-character flashes. All action images preload.

Each dungeon ends in a named boss; encounter counts come from its saved roster:

| Dungeon | Enemies | Boss |
| --- | --- | --- |
| Wetlands | Bog toad, drowned corpse, giant water strider, bog hag | Root Hulk |
| Embercrypt | Cinder imp, ash knight, fire wisp | The Furnace King |
| Frostbound Keep | Ice crawler, frost guard, snow beast | The Pale Regent |

Only one expedition can be active. Boss victory awards the whole pending bounty
once and unlocks the next dungeon. Exact remaining health carries forward even
if XP causes a level-up. Defeat, retreat, and expiry grant no gold or XP.
Focus charges stay consumed. Entry health is restored on failure/retreat.

Daily damage from successful expeditions is stored separately from max health.
More steps or armor can add available health; a healing potion reduces that
stored damage. Running helps avoid future damage. At 5 AM device time health
recovers. No dungeon entry is allowed at zero available health.

## Inventory and equipment

The Inventory tab replaces the forge's linear upgrades. One bag holds unequipped
gear, and seven slots hold weapon, armor, helmet, gloves, two rings and an amulet.
Each copy has its own ID, so two identical rings can be equipped independently.
Selecting an item opens its details and compares it with each compatible slot.
Equipping replaces the slot's old item and returns that item to the bag. Unequip
before selling for the displayed gold value. Changing/selling gear is blocked
while an expedition is active; its entry stats remain fixed.

Regular enemies have an initial 35% chance to drop one item. A boss always drops
one rare item. Enemy and boss rewards stay pending until victory; defeat,
retreat and expiry discard them without rerolling the seed. The final checkpoint
banks all gear, gold and XP once. Item snapshots preserve earned stats when the
catalog is later tuned. The initial pool and drop rates are provisional and
live in `src/game/equipment.ts`; later chapters scale its damage/health values.

Starter gear is a Wooden Club (20–30 damage) and Travel Wraps. Empty weapon slots
use 5–9 unarmed damage. Health gear, gloves and rings contribute only while
equipped. The Amulet of Restraint is now a possible boss drop, adding 0.01 to the
pushup coefficient; previously purchased copies are retained as equipped items.
There are no weapon or armor upgrade purchases.

Inventory → Supplies retains healing potions (30 gold, restore up to 40 HP at
camp) and focus potions (25 gold, +0.02 coefficient for ten attacks). Only one
focus potion can be active. Full-health healing and already-active focus are
blocked without consuming a charge. Potions can be bought during an expedition
but are drunk only at camp. All gear and unused supplies survive daily resets and
app restarts. XP levels still require 100 XP each.

## Daily challenges and screens

Daily optional quests remain: complete 10 pushups, walk 3,000 steps, run 1 km.
Each grants 20 gold once per fitness day. Progress comes from raw activity; combat cannot undo quest progress. Later goals can be
personalized for alternatives and recovery days.

Keep the dark woodland theme and pixel characters, with layouts that fit narrow
phones and the Fold.

The authored environment and enemy catalog is being rebuilt through user-led curation.
[content/catalog.toml](content/catalog.toml) registers
[Wetlands](content/biomes/wetlands/BIOME.toml), a hostile, abandoned environment
with no settled residents. Its five curated enemies now supply the first runtime expedition; combat values
remain provisional. Saved
[design guidelines](content/design_guidelines.toml) retain the agreed tone,
visual style, and descriptive writing conventions. The
[content format](content/README.md) and [content tool](scripts/content.py) support
curated TOML definitions and resolved JSON export. Runtime combat still
uses `src/game/combat.ts`; authored content does not automatically alter those battles.

- **Camp:** today's pushups, damage multiplier, damage per hit, available health,
  daily running dodge, today's activity, native step connection, and quests.
- **Dungeon:** portrait expedition picker and landscape full-screen travel/combat,
  pause/resume, retreat, boss rewards, and retry feedback.
- **Inventory:** equipment slots, a shared bag, item inspection/comparison, equip/unequip/sell, and potion supplies.
- **Progress:** seven-day raw activity chart, daily runs/pace/agility, lifetime
  totals, best pushup day, and today's pushup damage multiplier.
- **Pushups:** camera counter/corrections; save full reps to increase damage and
  record partials separately. Recalibration preserves accumulated totals.
- **Connected steps:** one-time Health Connect/HealthKit setup, automatic sync,
  last-sync/retry/disconnect, sharing instructions, and phone health settings.
- **GPS run:** start/pause/resume/finish/discard, distance, time, speed/pace, route,
  signal state, and earned dodge. No map key or cloud upload is required.

## Native steps and GPS recording

Android reads steps through Health Connect; Samsung Health must be allowed to
share its steps there. iPhone reads Apple Health through HealthKit. Request only
step read access. Use each platform's cumulative aggregate API to combine data
sources. Sync the last seven local days on connection, foreground entry, local-day
change, and once per minute while foregrounded. A failed read preserves the last
complete snapshot and exposes a retry state. Disconnecting stops queries while
keeping already saved history. HealthKit does not disclose read denial, so an
empty result must direct the player to check sharing/permissions rather than
claiming their permission was granted.

Running uses Expo Location and a TaskManager task registered outside screen
components. Request foreground/precise and background location on user-initiated
start; use an Android foreground-service notification and the iOS background
location mode. Continue with the screen locked. Pause, finish, and discard stop
location updates. Navigation does not stop a run. OS termination can interrupt
tracking; preserve accepted fixes and offer to resume an interrupted run.

Save GPS fixes incrementally in SQLite. Calculate distance from accepted fixes,
reject poor accuracy, timestamps outside active intervals, implausible jumps,
and small stationary jitter. A pause or long GPS gap starts a separate route
segment rather than drawing or rewarding a straight-line shortcut. Pace uses
accepted distance and active time, excluding pauses.

Motion-sensor steps provide a provisional observed count. Health data may arrive
later, so reconcile completed run steps from their active intervals on subsequent
health syncs. Never require users to type missing steps, and never invent steps
from GPS distance. Save valid GPS workouts even when step counts are still pending.
A unique recording key prevents retries from duplicating a workout. Deleting a
recorded run deletes its local route and recalculates its daily bonus.

Strava import/export is a separate **P3 feature, `frpg-y0j`**: OAuth connection,
source deduplication, imported routes, and export of locally recorded runs. No
Strava network requests are made in this version.

References: [Expo SDK 57 Location](https://docs.expo.dev/versions/v57.0.0/sdk/location/),
[TaskManager](https://docs.expo.dev/versions/v57.0.0/sdk/task-manager/),
[Health Connect aggregate data](https://developer.android.com/health-and-fitness/health-connect/aggregate-data),
[Health Connect React Native integration](https://matinzd.github.io/react-native-health-connect/docs/get-started/),
[HealthKit bindings](https://github.com/kingstinct/react-native-healthkit).

## Acceptance and validation

Verify zero-pushup entry, multiplier arithmetic, additive coefficient bonuses,
focus expiry, unchanged saved reps during combat, fixed entry power, stale tick
guards, rollback on failed saves, and the boss killing blow. Test deterministic dodge and critical/
proc sequences across enemy changes and persisted reloads, using saved RNG state.
Verify 5 AM device-time agility/health/pushup resets while resources/history persist, including
legacy migration and duplicate workout saves. Check potion ownership, gold,
full-health/active-focus guards, camp-only use, equipment swaps, duplicate rings, sales, and legacy gear conversion.

Keep victory-banked enemy/boss loot, seed advancement, exact carried HP, unlocks, and challenges covered by real
SQLite tests and screen interaction tests. Run TypeScript, lint, all logic/UI
tests, and an Android bundle. Physical checks should cover the damage/health
readouts, landscape entry/exit, sprite transitions, and narrow/Fold layouts, alongside native health and GPS behavior.
