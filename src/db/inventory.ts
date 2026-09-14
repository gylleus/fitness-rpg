import { eq, isNotNull, sql } from 'drizzle-orm';
import type { GameDb } from './game';
import { dungeonRuns, heroes, inventoryItems } from './schema';
import { fitsSlot, startingEquipment, upgradeGear, type EquipmentSlot } from '../game/equipment';

/** Convert old upgrades once. Sold starter gear is never recreated on reload. */
export function initializeInventory(db: GameDb) {
  db.transaction(tx => {
    const hero = tx.select().from(heroes).where(eq(heroes.id, 1)).get();
    if (!hero || hero.inventoryVersion >= 3) return;
    if (hero.inventoryVersion < 1) {
      for (const { item, slot } of startingEquipment(hero.swordLevel, hero.armorLevel, hero.amuletOwned)) {
        tx.insert(inventoryItems).values({ item, slot, acquiredAt: Date.now(), sourceKey: `legacy:${slot}` }).run();
      }
    } else {
      for (const owned of tx.select().from(inventoryItems).all()) {
        tx.update(inventoryItems).set({ item: upgradeGear(owned.item) }).where(eq(inventoryItems.id, owned.id)).run();
      }
    }
    tx.update(heroes).set({ inventoryVersion: 3 }).where(eq(heroes.id, 1)).run();
  });
}

export const getInventory = (db: GameDb) => db.select().from(inventoryItems).orderBy(inventoryItems.id).all();
export const getEquipped = (db: GameDb) => db.select().from(inventoryItems).where(isNotNull(inventoryItems.slot)).all();

function assertAtCamp(db: GameDb) {
  if (db.select().from(dungeonRuns).where(eq(dungeonRuns.status, 'active')).get()) {
    throw new Error('Return to camp before changing or selling equipment.');
  }
}

export function equipItem(db: GameDb, id: number, slot: EquipmentSlot) {
  return db.transaction(tx => {
    assertAtCamp(tx);
    const owned = tx.select().from(inventoryItems).where(eq(inventoryItems.id, id)).get();
    if (!owned) throw new Error('This item is no longer in your bag.');
    if (!fitsSlot(owned.item, slot)) throw new Error('This item does not fit that equipment slot.');
    tx.update(inventoryItems).set({ slot: null }).where(eq(inventoryItems.slot, slot)).run();
    tx.update(inventoryItems).set({ slot }).where(eq(inventoryItems.id, id)).run();
  });
}

export function unequipItem(db: GameDb, slot: EquipmentSlot) {
  return db.transaction(tx => {
    assertAtCamp(tx);
    tx.update(inventoryItems).set({ slot: null }).where(eq(inventoryItems.slot, slot)).run();
  });
}

export function sellItem(db: GameDb, id: number) {
  return db.transaction(tx => {
    assertAtCamp(tx);
    const owned = tx.select().from(inventoryItems).where(eq(inventoryItems.id, id)).get();
    if (!owned) throw new Error('This item has already been sold or is no longer owned.');
    if (owned.slot) throw new Error('Unequip this item before selling it.');
    tx.delete(inventoryItems).where(eq(inventoryItems.id, id)).run();
    tx.update(heroes).set({ gold: sql`${heroes.gold} + ${owned.item.sellValue}` }).where(eq(heroes.id, 1)).run();
    return owned.item.sellValue;
  });
}
