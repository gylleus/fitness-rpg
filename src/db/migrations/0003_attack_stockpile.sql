ALTER TABLE `heroes` ADD `pushup_units_spent` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `heroes` ADD `amulet_owned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `heroes` ADD `health_potions` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `heroes` ADD `focus_potions` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `heroes` ADD `focus_attacks` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `heroes` ADD `combat_meters` text DEFAULT '{"dodge":0,"effects":{}}' NOT NULL;
--> statement-breakpoint
-- End attempts using free attacks. Preserve fitness history, rewards already
-- banked, and old result screens; normalize JSON fields used by the new UI.
UPDATE dungeon_runs SET state = json_set(state,
  '$.pushupUnits', 0, '$.focusAttacks', 0, '$.attacksMade', 0,
  '$.meters', json('{"dodge":0,"effects":{}}'), '$.lastAction', 'travel',
  '$.stats.dodgeBps', 0, '$.stats.pushupCostUnits', 100, '$.stats.attackEffects', json('[]'));
--> statement-breakpoint
UPDATE dungeon_runs SET status = 'retreated', state = json_set(state,
  '$.status', 'retreated', '$.gold', 0, '$.xp', 0,
  '$.log', json_array('Combat has changed. Your saved pushups now form an attack stockpile. Start a fresh expedition.'))
WHERE status = 'active';
