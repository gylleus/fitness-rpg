import { beforeEach, expect, it, jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { usePoseModel } from '../../src/pose/usePoseModel';

const mockAsset = {
  uri: 'assets_models_movenetthunderint8',
  localUri: null as string | null,
  downloadAsync: jest.fn<() => Promise<void>>(),
};
const mockLoadModel = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('expo-asset', () => ({ Asset: { fromModule: () => mockAsset } }));
jest.mock('react-native-fast-tflite', () => ({
  loadTensorflowModel: (...args: unknown[]) => mockLoadModel(...args),
}));
jest.mock('../../assets/models/movenet-thunder-int8.tflite', () => 9);

beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'android');
  mockAsset.localUri = null;
  mockAsset.downloadAsync.mockReset().mockImplementation(async () => {
    mockAsset.localUri = 'file:///cache/ExponentAsset-model.tflite';
  });
  mockLoadModel.mockReset().mockResolvedValue({ runSync: jest.fn() });
});

it('opens a materialized file URI instead of the bare Android release resource', async () => {
  const { result } = await renderHook(usePoseModel);
  await waitFor(() => expect(result.current.state).toBe('loaded'));
  expect(mockAsset.downloadAsync).toHaveBeenCalledTimes(1);
  expect(mockLoadModel).toHaveBeenCalledWith(
    { url: 'file:///cache/ExponentAsset-model.tflite' }, expect.any(Array),
  );
});

it('shows an asset error and can load again when the workout is reopened', async () => {
  mockAsset.downloadAsync.mockRejectedValueOnce(new Error('Could not copy asset'));
  const first = await renderHook(usePoseModel);
  await waitFor(() => expect(first.result.current).toMatchObject({
    state: 'error', error: new Error('Could not copy asset'),
  }));
  expect(mockLoadModel).not.toHaveBeenCalled();
  await first.unmount();
  const second = await renderHook(usePoseModel);
  await waitFor(() => expect(second.result.current.state).toBe('loaded'));
});

it('does not send an unresolved resource to the native URL loader', async () => {
  mockAsset.downloadAsync.mockResolvedValue(undefined);
  const { result } = await renderHook(usePoseModel);
  await waitFor(() => expect(result.current.state).toBe('error'));
  expect(mockLoadModel).not.toHaveBeenCalled();
});

it('reports native model initialization errors', async () => {
  mockLoadModel.mockRejectedValue(new Error('Model initialization failed'));
  const { result } = await renderHook(usePoseModel);
  await waitFor(() => expect(result.current).toMatchObject({
    state: 'error', error: new Error('Model initialization failed'),
  }));
});

it('keeps counting available when Android GPU initialization is unsupported', async () => {
  mockLoadModel.mockRejectedValueOnce(new Error('GPU delegate failed to prepare'));
  const { result } = await renderHook(usePoseModel);
  await waitFor(() => expect(result.current.state).toBe('loaded'));
  expect(mockLoadModel).toHaveBeenNthCalledWith(1,
    { url: 'file:///cache/ExponentAsset-model.tflite' }, ['android-gpu']);
  expect(mockLoadModel).toHaveBeenNthCalledWith(2,
    { url: 'file:///cache/ExponentAsset-model.tflite' }, []);
});
