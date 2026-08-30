# Pose model

`movenet-lightning-int8.tflite` — MoveNet SinglePose Lightning, INT8 quantised.

Source: https://www.kaggle.com/models/google/movenet/tfLite/singlepose-lightning-tflite-int8
(version 1, downloadable without a Kaggle account via the `api/v1/.../download` endpoint).

Verified with a TFLite interpreter:

| | |
|---|---|
| Input | `[1, 192, 192, 3]` uint8 |
| Output | `[1, 1, 17, 3]` float32 |
| Size | 2.8 MB |

The output packs each of the 17 keypoints as **(y, x, score)** — y before x. `src/pose/model.ts`
is responsible for swapping into the conventional `{x, y}`; nothing downstream should have to
know about the model's ordering.

Lightning is chosen over Thunder for framerate. The loader takes a path, so swapping to Thunder
if accuracy falls short is a one-line change — see beads frpg-7cz for the accuracy spike.
