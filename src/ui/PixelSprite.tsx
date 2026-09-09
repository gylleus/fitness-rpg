import { View } from 'react-native';

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
  const palette: Record<string, string> = { C: tint, W: '#e4e9dc', K: '#192824', S: '#d6b799', G: '#eec977' };
  return <View accessible={false} style={{ width: size, height: pixel * 14, transform: [{ scaleX: flip ? -1 : 1 }] }}>
    {sprites[kind].flatMap((row, y) => [...row].map((cell, x) => cell !== ' ' ?
      <View key={`${x}-${y}`} style={{ position: 'absolute', left: x * pixel, top: y * pixel, width: pixel + 0.2, height: pixel + 0.2, backgroundColor: palette[cell] }} /> : null))}
  </View>;
}

export function CampScene() {
  return <View style={{ height: 172, backgroundColor: '#15231f', borderRadius: 16, overflow: 'hidden', justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 18 }}>
    {[12, 36, 67, 85].map((x, i) => <View key={x} style={{ position: 'absolute', left: `${x}%`, bottom: 20, height: 80 + i % 2 * 40, width: 12, backgroundColor: '#243a2f' }}>
      <View style={{ position: 'absolute', bottom: 35, left: -23, width: 0, height: 0, borderLeftWidth: 30, borderRightWidth: 30, borderBottomWidth: 90, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#2a4334' }} />
    </View>)}
    <View style={{ position: 'absolute', top: 16, right: 32, width: 24, height: 24, backgroundColor: '#e9d799', borderRadius: 12 }} />
    <View style={{ position: 'absolute', bottom: 0, height: 22, width: '100%', backgroundColor: '#304635' }} />
    <PixelSprite tint="#829cb4" />
  </View>;
}
