CREATE TABLE `activity_days` (
	`day` text PRIMARY KEY NOT NULL,
	`entered_steps` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `challenge_claims` (
	`day` text NOT NULL,
	`challenge_id` text NOT NULL,
	PRIMARY KEY(`day`, `challenge_id`)
);
--> statement-breakpoint
CREATE TABLE `dungeon_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` integer NOT NULL,
	`status` text NOT NULL,
	`state` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `heroes` (
	`id` integer PRIMARY KEY NOT NULL,
	`gold` integer DEFAULT 0 NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`sword_level` integer DEFAULT 0 NOT NULL,
	`armor_level` integer DEFAULT 0 NOT NULL,
	`unlocked_dungeon` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`distance_meters` real NOT NULL,
	`duration_seconds` real NOT NULL,
	`steps` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `runs_day_idx` ON `runs` (`day`);--> statement-breakpoint
CREATE UNIQUE INDEX `runs_source_key_idx` ON `runs` (`source_key`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `source_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_source_key_idx` ON `sessions` (`source_key`);--> statement-breakpoint
CREATE INDEX `sets_ended_at_idx` ON `sets` (`ended_at`);