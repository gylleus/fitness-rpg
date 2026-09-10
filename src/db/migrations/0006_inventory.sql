CREATE TABLE `dungeon_seeds` (
	`dungeon_id` integer PRIMARY KEY NOT NULL,
	`victories` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item` text NOT NULL,
	`slot` text,
	`acquired_at` integer NOT NULL,
	`source_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_slot_idx` ON `inventory_items` (`slot`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_source_idx` ON `inventory_items` (`source_key`);--> statement-breakpoint
ALTER TABLE `heroes` ADD `inventory_version` integer DEFAULT 0 NOT NULL;