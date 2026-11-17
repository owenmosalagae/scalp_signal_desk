CREATE TABLE `robot_control` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`enabled` integer NOT NULL,
	`runner_id` text NOT NULL,
	`account_key` text NOT NULL,
	`payload` text NOT NULL,
	`symbols` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `robot_runner` (
	`id` text PRIMARY KEY NOT NULL,
	`runner_id` text NOT NULL,
	`account_key` text NOT NULL,
	`payload` text NOT NULL,
	`received_at` integer NOT NULL
);
