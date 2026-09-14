import { InteriorBackdrop, type InteriorBackdropProps } from './InteriorBackdrop';
import { HOLLOW_DELVE_ASSETS } from './hollowDelve';

const textures = {
  depth: require('../../assets/biomes/hollow_delve/depth.png'),
  wall: require('../../assets/biomes/hollow_delve/wall.png'),
  roof: require('../../assets/biomes/hollow_delve/roof.png'),
  ground: require('../../assets/biomes/hollow_delve/slate_path.png'),
  props: require('../../assets/biomes/hollow_delve/props.png'),
};

export function HollowDelveBackdrop(props: InteriorBackdropProps) {
  return <InteriorBackdrop {...props} assets={HOLLOW_DELVE_ASSETS} textures={textures} testID="hollow-delve-scenery" />;
}
