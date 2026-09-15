import { View } from 'react-native';
import { spriteColor } from '../sprites/palette';

// Small code-native sprites: no network assets or font-dependent emoji artwork.
const sprites = {
  hero: [
    '      GGG       ', '     GGGGG      ', '     WWWWW      ', '     WKWWK      ', '     WWWWW   W  ', '      SSS    W  ',
    '   CCCWWCCC  W  ', '  CCCCCCCCC  W  ', '  CSSCCCCSSC GGG', '   SSCCCCSS  S  ', '     CCCC       ', '     CCCC       ',
    '     W  W       ', '    WW  WW      ',
  ],
  knight: [
    '     CCCCC      ', '    CCCCCCC     ', '    WWWWWWW     ', '    WKWWWKW     ', '     WWWWW   W  ', '      WWW    W  ',
    '   CCCWWCCC  W  ', '  CCCCCCCCC  W  ', '  CWWCCCCWW GGG ', '   WWCCCCWW  W  ', '     CCCC       ', '     CCCC       ',
    '     W  W       ', '    WW  WW      ',
  ],
  slime: [
    '                ', '                ', '                ', '                ', '       CC       ', '     CCCCCC     ',
    '    CCCCCCCC    ', '   CCCCCCCCCC   ', '  CCCWWCCWWCCC  ', '  CCCWKCCWKCCC  ', ' CCCCCCCCCCCCCC ', ' CCCCCCCCCCCCCC ',
    '  CCCCCCCCCCCC  ', '   CCCCCCCCCC   ',
  ],
  wolf: [
    '                ', '                ', '    C     C     ', '    CC   CC     ', '    CCCCCCC     ', '    CWCCCWC     ',
    '    CKKCKKC     ', '   CCCCCCCCC    ', '   CCCWWWCCC    ', ' CCCCCCWCCCCCC  ', 'CCCCCCCCCCCCCC  ', '   CCCCCCCCCC   ',
    '   CCC    CCC   ', '   WWW    WWW   ',
  ],
  boss: [
    '  G         G   ', '  GG       GG   ', '   GGCCCCCGG    ', '    CCCCCCC     ', '    CWCCCWC     ', '    CKCCCKC     ',
    '   CCCWWWCCC    ', '  CCCCCCCCCCC   ', ' CCCCGGGGGCCCC  ', ' CCCCGGGGGCCCC  ', '  CCCCCCCCCCC   ', '   CCCCCCCCC    ',
    '   CCC   CCC    ', '  GGGG   GGGG   ',
  ],
  sword: [
    '          WW    ', '         WWW    ', '        WWW     ', '       WWW      ', '      WWW       ', '     WWW        ',
    '  G WWW         ', '   GWW          ', '   SGG          ', '  SS  G         ', ' GG             ', '                ',
    '                ', '                ',
  ],
  armor: [
    '                ', '    WW   WW     ', '   CCCWWWCCC    ', '  CCCCCCCCCCC   ', '  CCCCCCCCCCC   ', '  WWCCCCCCCWW   ',
    '    CCGGGCC     ', '    CCCCCCC     ', '    CCCCCCC     ', '    CCGGGCC     ', '    CCCCCCC     ', '    WWWWWWW     ',
    '                ', '                ',
  ],
};
export function PixelSprite({ kind = 'hero', size = 112, tint = '#93b9a0', flip = false }: {
  kind?: keyof typeof sprites; size?: number; tint?: string; flip?: boolean;
}) {
  const pixel = size / 16;
  const palette: Record<string, string> = { C: spriteColor(tint), W: spriteColor('#c0cbdc'),
    K: spriteColor('#181425'), S: spriteColor('#e4a672'), G: spriteColor('#feae34') };
  return <View accessible={false} style={{ width: size, height: pixel * 14, transform: [{ scaleX: flip ? -1 : 1 }] }}>
    {sprites[kind].flatMap((row, y) => [...row].map((cell, x) => cell !== ' ' ?
      <View key={`${x}-${y}`} style={{ position: 'absolute', left: x * pixel, top: y * pixel, width: pixel + 0.2, height: pixel + 0.2, backgroundColor: palette[cell] }} /> : null))}
  </View>;
}
