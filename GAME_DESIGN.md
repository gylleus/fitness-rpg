# Fitness RPG — game design

## The promise

Real effort supplies an adventurer. Save pushups, build an attack stockpile,
walk for daily health, and run for daily agility. Watch automatic dungeon battles,
then turn boss bounties into lasting gear and useful consumables. Fitness history
also shows progress outside the game; spending resources never erases exercise.
An in-game level is adventure progress, not a measurement of physical ability.

## Core loop

1. Save a pushup workout: every full rep adds one pushup to the stockpile.
2. Sync native steps for health; record a GPS run for dodge from distance and pace.
3. Enter a dungeon. Travel right, stop at enemies, and auto-attack.
4. Every hero attack spends pushups. Defeat the boss to bank all gold and XP.
5. Upgrade sword/armor, buy a rare efficiency amulet, or buy potions with gold.
6. Wins carry exact remaining health into the next expedition. Failure restores
   entry health, refunds spent pushups, and grants zero loot. Used potion charges stay spent.

Unused pushups **carry over across days**, as do gear, gold, XP, unlocked dungeons,
potions, and unused focus charges. Daily step health and running agility expire
at local midnight, and health recovers to the new day's maximum.

## Character, resources, and initial balance

These are tunable game numbers, not prescribed workout targets.

| Source | Benefit | Lifetime |
| --- | --- | --- |
| Base character | 25 damage per hit, 100 health | Permanent |
| Sword upgrade | +3 damage per hit | Permanent |
| Armor upgrade | +20 health | Permanent |
| Each level after level 1 | +1 damage, +5 health | Permanent |
| Completed pushup | +1 pushup to the attack stockpile | Until spent |
| Every 100 steps today | +1 health | Until local midnight |
| Running distance and pace | Agility, expressed as deterministic dodge | Until local midnight |

Damage is independent of pushup count. Base damage is tuned to make the first
chapter attainable with a modest stockpile and daily step health: at 25 damage,
Mossfall needs 14 attacks and deals 142 damage before dodge. Gear reduces both
attacks needed and enemy retaliation. Partial reps stay in history but grant no
attack resources. There is no soft cap on credited full pushups.

### Pushup spending

One attack normally costs one pushup. Store hundredths of a pushup as integers:
100 units per completed rep, 90 units per attack with the 10% amulet. Ten such
attacks cost exactly nine pushups, without random free swings or rounding loss.
Efficiency reductions add in percentage points and are capped at 50% total.

Spend only when the hero actually attacks. Travelling, pausing, incoming enemy
attacks, and dodges cost no pushups. Critical hits and on-attack effects are part
of that one paid swing and do not charge extra. The killing blow also costs an
attack. Never allow an attack with insufficient resources or a negative balance.

Zero affordable attacks blocks dungeon entry. If the balance cannot cover the
next hero turn, the expedition ends as **exhausted**: zero gold/XP, entry health
and spent pushups restored. Unaffordable fractional leftovers stay banked. The UI
shows pushups remaining, next swing cost, and the exact number of attacks
available, including a focus potion wearing off. Training while an expedition is
paused adds usable resources when it resumes.

### Step health and running agility

Running steps are included in total steps once. Use the maximum of the native
aggregate and recorded running steps; never sum them as separate walking totals.
Running does not multiply health. Runs with pending native step data still earn
agility from saved distance and active duration.

```
level = 1 + floor(xp / 100)
damage = 25 + swordLevel * 3 + (level - 1)
dailyHealth = floor(totalSteps / 100)
health = 100 + armorLevel * 20 + (level - 1) * 5 + dailyHealth
speedKmh = distanceMeters / activeSeconds * 3.6
paceWeight = clamp(speedKmh / 8, 0.5, 1.5)
runDodgeBps = min(3000, round(distanceKm * 200 * paceWeight))
dodgeBps = min(3000, sum(runDodgeBps))
```

One basis point is 0.01%. At 8 km/h, 5 km earns 10% dodge; at 12 km/h it earns
15%. Ten kilometers at 8 km/h earns 20%. Faster paces stop increasing the weight
at 12 km/h, and total daily dodge is capped at 30%. Multiple runs use their own
pace before summing. A short sprint cannot boost an entire day's activity.

### Deterministic dodge and attack effects

There are no random combat rolls. On every incoming enemy attack, add the dodge
rate to a saved meter. At 10,000 basis points, dodge the whole attack and subtract
10,000. Starting from zero, 20% dodges attacks 5, 10, 15, and so on. Arbitrary rates
also work: 15% dodges attacks 7, 14, 20, etc. A dead enemy never attacks and never
advances the dodge meter.

Meters carry across enemies, retries, successful expeditions, day changes, and
app restarts. Pausing or re-entering cannot reset their progress. The entry dodge
rate stays fixed for that expedition; if a later expedition has a different rate,
it advances the existing remainder at its new rate. Zero dodge adds nothing.

Damage resolution is a pure function producing typed damage/healing events. Item
effects have stable unique IDs, an on-attack trigger, a basis-point rate, and an
effect payload. Each effect owns a saved deterministic meter. Resolution order:

1. Check and spend the attack cost; consume one active focus charge.
2. Advance each on-attack effect meter once.
3. Apply triggered critical modifiers to weapon damage (strongest multiplier
   wins; round down once). Baseline critical rate is zero.
4. Append triggered flat damage and healing effects in equipment order. Flat
   proc damage is not multiplied by a weapon critical. Healing caps at max HP.
5. Apply the result, process enemy death, then save everything atomically.

Proc damage does not recurse into more attacks/procs. Effects may activate on a
killing blow. This version implements and tests critical, extra damage, and
healing effect support; the current item catalog does not yet grant these effects.
Later items can supply effect definitions without changing battle turns or the
screen. New trigger types should get an explicit resolution stage when needed.

## Time, persistence, and migration

A day is a local calendar date. Derive health/agility from saved activity and
refresh on foreground entry and midnight; no reset job or deletion is needed.
Pushup sets and GPS workouts belong to their completion date. An active dungeon
expires when the local date changes, dropping pending loot and refunding spent
pushups. Used potion charges stay consumed. Meters and focus charges carry over. Version one trusts the phone's
clock; no streak penalty applies on rest days.

Use the existing expo-sqlite + Drizzle database, offline with no new account or
backend. [Expo SDK 57 SQLite](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/).

| Data | Stored information |
| --- | --- |
| Sessions and sets | Exercise, timestamps, full/partial reps, form data |
| Activity days | Native aggregate steps, source, sync time, legacy total |
| Runs | Completion date, source/key, distance, active seconds, steps, recording ID |
| Recordings and route points | Status, pause intervals, accepted GPS fixes, route gaps |
| Health connection | Explicit opt-in and last completed sync |
| Hero | Gold, XP, gear, unlocks, daily damage, spent pushup units, potions, focus charges, combat meters |
| Dungeon runs | Entry stat snapshot, resources, meters, turns, combat log, pending rewards |
| Challenge claims | Unique local date + challenge ID |

Stockpile = all saved full pushup reps × 100 − persisted spent units, floored at
zero. Existing pushup history becomes the initial stockpile; it is not copied or
credited repeatedly. Workout save keys prevent duplicate deposits. Gold and
resource changes use database transactions. Every paid attack saves spending,
meters, potion charges, and battle state together. A stale tick does nothing; a
failed checkpoint rolls back the entire turn, including any final boss reward.
Track actual pushup units paid per attempt in its saved state. An unsuccessful
result and its refund commit together; repeated callbacks cannot refund twice.
Refund spending rather than replacing the balance, preserving workouts saved
during an expedition. Successful attempts keep their costs permanently.

Migration 0003 adds hero resource fields and ends active attempts from the old
free-attack rules without awarding pending loot. It normalizes old result JSON
for display and preserves workouts, banked rewards, equipment, and saved routes.

## Automatic dungeon battles

The hero moves right through a scrolling woodland, stopping to auto-attack each
enemy. Three saved travel steps separate encounters. The hero attacks first;
surviving enemies retaliate. Show both health bars, damage, stockpile/cost, dodge,
the next dodge countdown, and a combat log. A dodge displays a miss and a backward
movement. Navigating away or backgrounding pauses the battle.

Each dungeon has four encounters, ending in a named boss:

| Dungeon | Enemies | Boss |
| --- | --- | --- |
| Mossfall Hollow | Slime, thornling, wolf | The Rootwarden |
| Embercrypt | Cinder imp, ash knight, fire wisp | The Furnace King |
| Frostbound Keep | Ice crawler, frost guard, snow beast | The Pale Regent |

Only one expedition can be active. Boss victory awards the whole pending bounty
once and unlocks the next dungeon. Exact remaining health carries forward even
if XP causes a level-up. Replaying spends pushups and any health lost in combat.
Defeat, exhaustion, retreat, and expiry grant no gold or XP and refund the exact
pushup cost paid in that attempt, including fractional costs. Focus charges stay consumed. Entry health is restored on failure/retreat.

Daily damage from successful expeditions is stored separately from max health.
More steps or armor can add available health; a healing potion reduces that
stored damage. Running helps avoid future damage. At local midnight health
recovers. No dungeon entry is allowed at zero available health.

## Permanent progression and items

Sword and armor start at upgrade level zero and are always equipped. Each upgrade
costs `30 + currentUpgradeLevel * 25` gold. XP levels require 100 XP each. Stats and
equipment effects are snapshotted at entry, so a forge upgrade affects the next
expedition. Purchase and inventory changes are atomic and cannot overspend gold.

| Item | Acquisition | Effect |
| --- | --- | --- |
| Amulet of Restraint · rare | 150 gold after defeating the Rootwarden; buy once | Permanently reduces pushup usage by 10% |
| Healing potion | 30 gold each | Drink at camp to restore up to 40 HP |
| Focus potion | 25 gold each | Drink at camp for 20% lower usage on the next 10 paid attacks |

The rare amulet is a guaranteed unlock and merchant purchase, with no RNG drop.
Amulet + focus costs 0.7 pushups per attack. Focus lasts for attacks, not time,
and charges are consumed even on failed expeditions. Only one focus potion can
be active. Drinking at full health or while already focused is blocked without
consuming an item. Potions can be bought during an expedition but are drunk only
at camp after finishing or retreating. Inventory survives restarts and midnight.

## Daily challenges and screens

Daily optional quests remain: complete 10 pushups, walk 3,000 steps, run 1 km.
Each grants 20 gold once per date. Progress comes from raw activity, not unspent
resources. Spending pushups cannot undo quest progress. Later goals can be
personalized for alternatives and recovery days.

Keep the dark woodland theme and pixel characters, with layouts that fit narrow
phones and the Fold.

The authored environment and enemy catalog is being rebuilt through user-led curation.
[content/catalog.toml](content/catalog.toml) registers
[Wetlands](content/biomes/wetlands/BIOME.toml), a hostile, abandoned environment
with no settled residents. Its first curated enemy is the Bog Toad; combat values
remain provisional. Saved
[design guidelines](content/design_guidelines.toml) retain the agreed tone,
visual style, and descriptive writing conventions. The
[content format](content/README.md) and [content tool](scripts/content.py) support
curated TOML definitions and resolved JSON export. Runtime combat still
uses `src/game/combat.ts`; authored content does not automatically alter those battles.

- **Camp:** stockpile, affordable attacks, cost, damage per hit, available health,
  daily running dodge, today's activity, native step connection, and quests.
- **Dungeon:** travel/combat, resource use, exact dodge timing, pause/resume,
  retreat, boss rewards, and exhaustion/retry feedback.
- **Forge:** permanent upgrades, rare amulet unlock/purchase, potion shop and use.
- **Progress:** seven-day raw activity chart, daily runs/pace/agility, lifetime
  totals, best pushup day, and a separate unspent/spent resource summary.
- **Pushups:** camera counter/corrections; save full reps into the stockpile and
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

Verify integer spending, fractional amulet/focus costs and expiry, exact depletion,
exactly-once refunds on losses/retreats/expiry, no duplicate charges on stale ticks, rollback on
failed saves, and a paid boss killing blow. Test deterministic dodge and critical/
proc sequences across enemy changes and persisted reloads, with no RNG calls.
Verify daily agility/health reset while resources/history persist, including
legacy migration and duplicate workout saves. Check potion ownership, gold,
full-health/active-focus guards, camp-only use, and permanent amulet unlocks.

Keep boss-only loot, exact carried HP, unlocks, and challenges covered by real
SQLite tests and screen interaction tests. Run TypeScript, lint, all logic/UI
tests, and an Android bundle. Physical checks should cover the resource/dodge
readouts and narrow/Fold layouts, alongside native health and GPS behavior.
