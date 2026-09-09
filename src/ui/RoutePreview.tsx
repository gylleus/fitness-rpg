import { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { routePaths, type RoutePoint } from '../running/route';
import { colors, ui } from './theme';
export function RoutePreview({ points }: { points: RoutePoint[] }) {
  const [width, setWidth] = useState(300);
  // Keep long runs cheap to draw while preserving boundaries between segments.
  const stride = Math.max(1, Math.ceil(points.length / 600));
  const preview = points.filter((p, i) => i % stride === 0 || p.breakBefore || i === points.length - 1 || points[i + 1]?.breakBefore);
  return <View accessibilityLabel={`GPS route with ${points.length} recorded points`} onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ height: 220, borderRadius: 16, backgroundColor: colors.bg, overflow: 'hidden', justifyContent: 'center' }}>
    {points.length > 1 ? <Svg width={width} height={220}>{routePaths(preview, width, 220).map((path, i) => <Path key={i} d={path} stroke={colors.green} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}</Svg> : <Text style={[ui.small, { textAlign: 'center', padding: 24 }]}>Your route appears here once GPS records movement outdoors.</Text>}
  </View>;
}
