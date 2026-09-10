import type { GameDb } from '../src/db/game';
import { getHero } from '../src/db/game';
import { equipItem } from '../src/db/inventory';
import { inventoryItems } from '../src/db/schema';
import type { EquipmentSlot, GearItem } from '../src/game/equipment';

let source = 0;
export function giveItem(db: GameDb, item: GearItem, slot?: EquipmentSlot) {
  getHero(db);
  const owned = db.insert(inventoryItems).values({ item, acquiredAt: 0, sourceKey: `fixture:${++source}` }).returning().get();
  if (slot) equipItem(db, owned.id, slot);
  return owned;
}
