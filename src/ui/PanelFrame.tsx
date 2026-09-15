import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { menuArt } from './art';

/** Eight border slices, with a native-color center. Works on Android and iOS;
 * Image.capInsets alone only preserves corners on iOS. Fractions describe the
 * generated source, while the displayed corners stay 18 logical pixels. */
export function PanelFrame() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const corner = 18;
  const widths = [corner, Math.max(0, size.width - corner * 2), corner];
  const heights = [corner, Math.max(0, size.height - corner * 2), corner];
  const fractions = [0.08, 0.84, 0.08];
  const offsets = [0, 0.08, 0.92];
  return <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
    style={StyleSheet.absoluteFill} onLayout={({ nativeEvent: { layout } }) => {
      setSize(previous => previous.width === layout.width && previous.height === layout.height ? previous : { width: layout.width, height: layout.height });
    }}>
    {size.width > 0 && size.height > 0 && heights.flatMap((height, row) => widths.map((width, col) => {
      if (row === 1 && col === 1) return null;
      const imageWidth = width / fractions[col];
      const imageHeight = height / fractions[row];
      return <View key={`${row}-${col}`} style={{ position: 'absolute', overflow: 'hidden', width, height,
        left: col === 0 ? 0 : col === 1 ? corner : size.width - corner,
        top: row === 0 ? 0 : row === 1 ? corner : size.height - corner }}>
        <Image source={menuArt.frame} resizeMode="stretch" accessible={false}
          style={{ position: 'absolute', width: imageWidth, height: imageHeight,
            left: -offsets[col] * imageWidth, top: -offsets[row] * imageHeight }} />
      </View>;
    }))}
  </View>;
}
