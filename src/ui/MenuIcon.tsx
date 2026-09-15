import Svg, { Path } from 'react-native-svg';
import type { ColorValue } from 'react-native';

export type MenuIconName = 'camp' | 'sword' | 'pack' | 'journal' | 'strength' | 'steps' | 'run' | 'coin';
const paths: Record<MenuIconName, string> = {
  camp: 'M3 20 12 4l9 16H3Zm5 0 4-8 4 8M12 4V2M4 20H2m18 0h2',
  sword: 'm5 19 3-3m-3-3 6 6m-3-6L18 3h3v3L11 16M4 20l-1 1',
  pack: 'M6 8h12l2 3v10H4V11l2-3Zm3 0V4h6v4M4 12h16M8 12v3m8-3v3M8 18h8',
  journal: 'M5 3h15v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 0v18m4-13h5m-5 4h5m-5 4h3',
  strength: 'M3 9v6m3-8v10m12-10v10m3-8v6M6 12h12',
  steps: 'm7 3 3 1 1 5-2 3-4-1V7l2-4Zm-2 11 4 1-1 4-3-1v-4Zm12-7 2 4v4l-4 1-2-3 1-5 3-1Zm2 11v4l-3 1-1-4 4-1',
  run: 'm13 8 3 3h4m-9-2-4 3H3m8-3 2-3h3l1 2m-6 1-1 6 4 2 2 5m-6-7-3 5H2M15 2h2v2h-2V2Z',
  coin: 'm8 3-5 5v8l5 5h8l5-5V8l-5-5H8Zm3 4h3m-3 10h3m-2-10v10',
};

/** Code-native symbols stay crisp and share the generated artwork's angular style. */
export function MenuIcon({ name, color = '#d7bb82', size = 24 }: { name: MenuIconName; color?: ColorValue; size?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
    <Path d={paths[name]} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="square" strokeLinejoin="miter" />
  </Svg>;
}
