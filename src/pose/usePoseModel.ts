import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Asset } from 'expo-asset';
import { loadTensorflowModel, type TensorflowPlugin } from 'react-native-fast-tflite';

/** Resolve the bundled model to a real file before passing it to TFLite.
 * Android release assets otherwise resolve to a bare resource name, which
 * fast-tflite's URL loader cannot open. Expo copies that resource locally;
 * the packaged app does not need a network connection.
 */
export function usePoseModel(): TensorflowPlugin {
  const [state, setState] = useState<TensorflowPlugin>({ state: 'loading', model: undefined });

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const asset = Asset.fromModule(require('../../assets/models/movenet-thunder-int8.tflite'));
        await asset.downloadAsync();
        if (!active) return;
        if (!asset.localUri?.startsWith('file://')) {
          throw new Error('The bundled pushup model could not be opened. Please reopen this workout.');
        }
        const source = { url: asset.localUri };
        // GPU delegates are unavailable on some Android devices/emulators.
        // Keep counting usable there with TFLite's standard CPU backend.
        const model = Platform.OS === 'android'
          ? await loadTensorflowModel(source, ['android-gpu']).catch(() => loadTensorflowModel(source, []))
          : await loadTensorflowModel(source, []);
        if (active) setState({ state: 'loaded', model });
      } catch (error) {
        if (active) setState({
          state: 'error', model: undefined,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  return state;
}
