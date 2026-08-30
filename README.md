# Fitness RPG

A fitness tracker structured as a role-playing game: completing real workouts levels up your
character and earns rewards.

**Milestone 1 is deliberately not the game.** It is a single question — *can we count pushups
reliably from the phone camera?* Everything else (XP, levels, quests, rewards) is layered on
only after that works.

## Stack

| | |
|---|---|
| App | Expo SDK 57 / React Native 0.86, TypeScript |
| Camera | react-native-vision-camera v5 (Nitro) |
| Pose | MoveNet SinglePose Lightning INT8 via react-native-fast-tflite |
| Storage | expo-sqlite + Drizzle — local only, no backend |
| Targets | Android (local builds) and iOS (EAS cloud builds) |

Development happens on Linux, so **iOS binaries are built in the cloud via EAS** — there is no
local Xcode. Android is built and debugged locally against a physical device.

## How the pushup counter works

A pose model emits 17 body keypoints per camera frame. Reps are counted from the **elbow angle**
(shoulder→elbow→wrist) rather than from pixel positions, which makes the count invariant to how
far you are from the phone, your body size, and the camera height. A hysteresis state machine
counts a rep on `UP → DOWN → UP`; the shoulder-hip-knee angle gates form.

The detector (`src/reps/detector.ts`) is a **pure function over a keypoint stream** — no React,
no camera, no native dependencies. That is what lets it be tested and tuned on a laptop against
recorded fixtures instead of by doing pushups on every code change.

## Requirements

- Node 22+
- JDK 17 (RN 0.86 will not build on 11)
- Android SDK with platform-tools, `ANDROID_HOME` set
- A physical Android phone in USB-debug mode

**Expo Go will not work** — the native camera and TFLite modules require a dev client.

## Development

```bash
npm install
npm test                  # detector tests, no device needed
npx expo run:android      # builds and installs the dev client
```

## Issue tracking

This repo uses [beads](https://github.com/steveyegge/beads). `bd ready` shows unblocked work.

```bash
bd ready                  # what can be worked on now
bd show <id>              # detail
bd update <id> --claim    # start
bd close <id>             # finish
```
