import { InteriorBackdrop, type InteriorBackdropProps } from './InteriorBackdrop';
import { INTERIOR_LOCATIONS, type InteriorLocationId } from './interiorLocations';

// Metro needs static requires. Only the selected location is decoded by Skia.
const textures = {
  hollow_delve: {
    depth: require('../../assets/biomes/hollow_delve/depth.png'),
    wall: require('../../assets/biomes/hollow_delve/wall.png'),
    roof: require('../../assets/biomes/hollow_delve/roof.png'),
    ground: require('../../assets/biomes/hollow_delve/slate_path.png'),
    props: require('../../assets/biomes/hollow_delve/props.png'),
  },
  lava_caves: {
    depth: require('../../assets/biomes/lava_caves/depth.png'),
    wall: require('../../assets/biomes/lava_caves/wall.png'),
    roof: require('../../assets/biomes/lava_caves/roof.png'),
    ground: require('../../assets/biomes/lava_caves/ground.png'),
    props: require('../../assets/biomes/lava_caves/props.png'),
  },
  frost_caves: {
    depth: require('../../assets/biomes/frost_caves/depth.png'),
    wall: require('../../assets/biomes/frost_caves/wall.png'),
    roof: require('../../assets/biomes/frost_caves/roof.png'),
    ground: require('../../assets/biomes/frost_caves/ground.png'),
    props: require('../../assets/biomes/frost_caves/props.png'),
  },
  crypts: {
    depth: require('../../assets/biomes/crypts/depth.png'),
    wall: require('../../assets/biomes/crypts/wall.png'),
    roof: require('../../assets/biomes/crypts/roof.png'),
    ground: require('../../assets/biomes/crypts/ground.png'),
    props: require('../../assets/biomes/crypts/props.png'),
  },
  fortress: {
    depth: require('../../assets/biomes/fortress/depth.png'),
    wall: require('../../assets/biomes/fortress/wall.png'),
    roof: require('../../assets/biomes/fortress/roof.png'),
    ground: require('../../assets/biomes/fortress/ground.png'),
    props: require('../../assets/biomes/fortress/props.png'),
  },
} satisfies Record<InteriorLocationId, Record<string, number>>;

export function InteriorLocationBackdrop({ location, ...props }: InteriorBackdropProps & { location: InteriorLocationId }) {
  return <InteriorBackdrop key={location} {...props} assets={INTERIOR_LOCATIONS[location]} textures={textures[location]}
    testID={`${location.replaceAll('_', '-')}-scenery`} />;
}
