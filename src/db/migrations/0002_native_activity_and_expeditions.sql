CREATE TABLE `health_connections` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`synced_at` integer
);
--> statement-breakpoint
CREATE TABLE `route_points` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recording_id` text NOT NULL,
	`timestamp` integer NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`accuracy` real NOT NULL,
	`altitude` real,
	`segment` integer NOT NULL,
	`break_before` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `run_recordings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `route_recording_idx` ON `route_points` (`recording_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `route_sample_idx` ON `route_points` (`recording_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `run_recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`segments` text NOT NULL,
	`distance_meters` real DEFAULT 0 NOT NULL,
	`observed_steps` integer DEFAULT 0 NOT NULL,
	`last_fix_at` integer,
	`error` text
);
--> statement-breakpoint
ALTER TABLE `activity_days` ADD `native_steps` integer;--> statement-breakpoint
ALTER TABLE `activity_days` ADD `step_source` text;--> statement-breakpoint
ALTER TABLE `activity_days` ADD `synced_at` integer;--> statement-breakpoint
ALTER TABLE `heroes` ADD `damage_day` text;--> statement-breakpoint
ALTER TABLE `heroes` ADD `damage_taken` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `recording_id` text;
--> statement-breakpoint
UPDATE dungeon_runs SET status = 'retreated', state = json_set(state, '$.status', 'retreated', '$.gold', 0, '$.xp', 0, '$.phase', 'travelling', '$.travel', 0, '$.entryHp', json_extract(state, '$.stats.health'), '$.log', json_array('Dungeon rules changed. Start a fresh expedition.')) WHERE status = 'active';
