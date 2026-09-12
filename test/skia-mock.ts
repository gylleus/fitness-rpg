// Mock only the native drawing boundary. Playback, timers and geometry stay real.
import { jest } from '@jest/globals';

jest.mock('@shopify/react-native-skia', () => {
  const { View } = require('react-native');
  const { createElement } = require('react');
  const image = {};
  return {
    Canvas: View, Group: View, Image: View, Rect: View,
    ImageShader: (props: Record<string, unknown>) => createElement(View, { ...props, testID: 'native-scene-shader' }),
    Atlas: (props: Record<string, unknown>) => createElement(View, { ...props, testID: 'native-sprite-atlas' }),
    FilterMode: { Nearest: 0 }, MipmapMode: { None: 0 },
    Skia: { RSXform: (scos: number, ssin: number, tx: number, ty: number) => ({ scos, ssin, tx, ty }) },
    useImage: () => image,
  };
});

jest.mock('react-native-reanimated', () => require('./shared-value-mock'));
