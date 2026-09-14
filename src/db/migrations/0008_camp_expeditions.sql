CREATE TABLE `camp_maps` (
	`id` integer PRIMARY KEY NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`offers` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `travel_days` (
	`day` text PRIMARY KEY NOT NULL,
	`spent` integer DEFAULT 0 NOT NULL
);
