# Pose model

**In use: `movenet-thunder-int8.tflite`** — MoveNet SinglePose Thunder, INT8 quantised.

Source: https://www.kaggle.com/models/google/movenet/tfLite/singlepose-thunder-tflite-int8
(version 1, downloadable without a Kaggle account via the `api/v1/.../download` endpoint).

Verified with a TFLite interpreter:

| | Thunder (in use) | Lightning (kept) |
|---|---|---|
| Input | `[1, 256, 256, 3]` uint8 | `[1, 192, 192, 3]` uint8 |
| Output | `[1, 1, 17, 3]` float32 | `[1, 1, 17, 3]` float32 |
| Size | 6.8 MB | 2.8 MB |

Lightning was the original choice, for framerate. On a head-on camera at 1-2m it
cleared the 0.30 confidence gate on only ~51% of frames, with every joint sitting
around 0.31 mean — the descent stopped being tracked partway down and reps scored
as partials. Measured inference was 8-9ms against a 33ms budget, so there was
plenty of headroom to spend on accuracy. Lightning is kept for the case where
Thunder proves too slow on some device.

The output packs each of the 17 keypoints as **(y, x, score)** — y before x. `src/pose/model.ts`
is responsible for swapping into the conventional `{x, y}`; nothing downstream should have to
know about the model's ordering.

Lightning is chosen over Thunder for framerate. The loader takes a path, so swapping to Thunder
if accuracy falls short is a one-line change — see beads frpg-7cz for the accuracy spike.
