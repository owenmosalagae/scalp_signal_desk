CREATE TABLE `signals` (
	`id` text PRIMARY KEY NOT NULL,
	`stream_id` text NOT NULL,
	`payload` text NOT NULL,
	`confirmed_at` integer NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `streams` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`snapshot_at` integer NOT NULL,
	`received_at` integer NOT NULL
);
