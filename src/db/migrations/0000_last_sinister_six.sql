CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exercise` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_started_at_idx` ON `sessions` (`started_at`);--> statement-breakpoint
CREATE TABLE `sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`valid_reps` integer DEFAULT 0 NOT NULL,
	`partial_reps` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`avg_rep_ms` real,
	`form_flags` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sets_session_id_idx` ON `sets` (`session_id`);