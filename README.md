# Fitness RPG

A fitness tracker structured as a role-playing game: completing real workouts levels up your
character and earns rewards.

The playable version connects camera-counted pushups, native step totals, and GPS runs to an RPG:
train, clear automatic dungeon battles, and collect, equip or sell dungeon loot.
The full rules, balance, storage model, and future integrations are in [GAME_DESIGN.md](GAME_DESIGN.md).

## Play the first version

- **Camp:** check your pushup damage multiplier, health, and dodge, train pushups, and claim daily quests.
- **Pushups:** use the existing camera counter, correct any miscounts, then choose
  **Finish & save** to record the workout and increase your damage multiplier.
- **Connected steps:** connect Health Connect on Android or Apple Health on iPhone.
  Totals then sync automatically; there is no manual step-entry form. On Samsung,
  enable step sharing in Samsung Health → Settings → Health Connect first.
- **Run:** start GPS recording, pause/resume, then finish. See distance, active time,
  pace, a saved route trace, and daily dodge earned from distance and speed. Background location permission lets tracking
  continue with the screen locked; an Android notification shows an active run.
- **Dungeon:** the hero walks right through the scrolling world, stopping to fight.
  Defeat the final boss to bank all gold and XP. Failure/retreat gives zero loot
  and restores entry health. Expeditions fill the screen in landscape, with pause and
  retreat controls. Saved pushups multiply base damage by `1 + 0.1 * pushups` and
  are never consumed. A victory carries remaining health into the next run.
  Walking and the camera move continuously between encounters, switching straight
  into an attack on arrival. Damage numbers pop on impact, drift upward and fade;
  pause and speed controls apply to both.
- **Inventory:** one bag for collected gear, with weapon, armor, helmet, gloves,
  two rings and amulet slots. Inspect items to compare, equip, unequip or sell.
  Enemies can drop gear and bosses guarantee an item; victory secures all drops.
  Weapons roll within their damage range. Combat and loot replay on retries;
  only victory advances that dungeon's seed. Gear changes take effect at camp.
  Buy and drink potions under Supplies. Existing upgrades become equipped items
  with their earned bonuses preserved. Saved gear and pushup power carry over;
  step health and running dodge reset at local midnight.
- **Progress:** view daily activity, running pace and routes, lifetime totals, and
  delete incorrect runs (including their saved routes).

Step data may take a few minutes to arrive from a health app or watch. Completed
runs reconcile their steps on later health syncs; GPS workouts remain saveable
without step access. HealthKit intentionally hides whether read permission was
denied, so check Health permissions if a connected total remains empty.

Data stays in local SQLite, with no account/server or cloud backup. Force-closing
an active GPS run can interrupt platform location delivery; recorded points are
retained and the run can be resumed. Strava import/export is planned in **frpg-y0j
(P3)** and is not connected yet.

## Stack

| | |
|---|---|
| App | Expo SDK 57 / React Native 0.86, TypeScript |
| Camera | react-native-vision-camera v5 (Nitro) |
| Pose | MoveNet SinglePose Thunder INT8 via react-native-fast-tflite |
| Storage | expo-sqlite + Drizzle — local only, no backend |
| Targets | Android (local builds) and iOS (EAS cloud builds) |

Development happens on Linux, so **iOS binaries are built in the cloud via EAS** — there is no
local Xcode. Android is built and debugged locally against a physical device.

## How the pushup counter works

A pose model emits 17 body keypoints per camera frame. The active camera detector
uses shoulder/body displacement, normalized by body scale, and self-calibrates in
pushup position. It records full and shallow reps separately. Manual corrections
remain available, and recalibration preserves the workout's rep totals.

The active detector (`src/reps/headDetector.ts`) is a **pure function over a keypoint stream** — no React,
no camera, no native dependencies. That is what lets it be tested and tuned on a laptop against
recorded fixtures instead of by doing pushups on every code change.

## Requirements

- Node 22+
- JDK 17 (RN 0.86 will not build on 11)
- Android SDK with platform-tools, `ANDROID_HOME` set
- A physical Android phone in USB-debug mode

**Expo Go will not work** — the native camera and TFLite modules require a dev client.

## Development

With [just](https://github.com/casey/just) installed, run `just android` to build,
install, and open the development app on your connected phone. For later sessions,
run `just start` and scan the terminal QR code with your phone on the same Wi-Fi.
Run `just android` again after native dependencies change.
The recipes use `ANDROID_HOME` or `ANDROID_SDK_ROOT` when set, otherwise
`~/Android/Sdk`, and put its `platform-tools` directory on the recipe's PATH.

If Expo reports no connected device, unlock the phone and enable USB debugging
(with a data cable), or enable Wireless debugging on the same Wi-Fi. For an
already-paired wireless phone, run `just connect IP:PORT` using the current address
on its Wireless debugging screen, then `just android`. `adb devices -l` should list
the phone as `device`; `adb mdns services` can also show its current connection
address. The wireless address and port can change between sessions.

```bash
npm install
npm test                  # logic/database tests and native screen interaction tests
npm run test:logic        # fast detector, game-rule, and SQLite tests
npm run test:ui           # real screens/navigation backed by SQLite; hardware mocked
npm run typecheck
npm run lint
npx expo run:android      # builds and installs the dev client
```

To build a standalone Android preview that launches without Metro:

```bash
npm run android:preview
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

The preview script includes ARM64 phones and x86_64 emulators, and uses the project's
development signing key. Store distribution needs its own release signing setup.

### Install updates from your phone

After building a preview, start the download page on the computer:

```bash
npm run android:share
```

Open the printed HTTP address on your Android phone on the same Wi-Fi and bookmark
it. Tap **Download Android app**, open the APK, and choose **Update**. Allow your
browser to install apps if Android asks. Install over the existing app to preserve
your local workouts and hero; do not uninstall first. The signing key and package
name must remain the same for Android to accept an update.

Leave the computer and the share process running. The page shows the build time
and serves the latest release APK after each completed `npm run android:preview`;
it does not build the app or update it automatically. Only the download page and
APK are exposed. Stop sharing with Ctrl+C. If the computer's IP changes, use the
new printed address. Set `FITNESS_SHARE_HOST` and `FITNESS_SHARE_PORT` to choose a
different local address or port (default 8787).

The game uses the existing SQLite database and additive Drizzle migrations, preserving
old workouts. SQL migrations are inlined by Babel; restart Metro with `npx expo start
--dev-client --clear` after updating from the counter-only version. The native health and location integrations require a rebuilt app, not just a Metro reload.

Bundle verification without a connected phone:

```bash
CI=1 npx expo export --platform android --output-dir /tmp/fitness-rpg-android-export
```

Validation covers game rules, real migrated SQLite, actual React screen actions,
health sync and errors, and GPS start/pause/resume/finish using native-boundary
sensor fixtures. TypeScript, lint, and an ARM64 Android release build are checked.
Physical-device checks are still required for Samsung Health sharing, location
permissions, screen-lock recording, GPS accuracy/battery, and iOS HealthKit.

## Issue tracking

This repo uses [beads](https://github.com/steveyegge/beads). `bd ready` shows unblocked work.

```bash
bd ready                  # what can be worked on now
bd show <id>              # detail
bd update <id> --claim    # start
bd close <id>             # finish
```
