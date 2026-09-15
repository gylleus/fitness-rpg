import { Image, StyleSheet, View } from 'react-native';
import { menuArt } from './art';
import { PanelFrame } from './PanelFrame';

export function MenuBanner() {
  return <View style={{ aspectRatio: 2.7, maxHeight: 210, overflow: 'hidden', backgroundColor: '#232630' }}>
    <Image source={menuArt.inventory} resizeMode="cover" accessible={false} style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]} />
    <PanelFrame />
  </View>;
}
