ALTER TABLE `members` ADD `phone` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `magic_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `members_magic_token_unique` ON `members` (`magic_token`);--> statement-breakpoint
ALTER TABLE `parties` ADD `magic_links_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `parties` ADD `sms_template` text DEFAULT '' NOT NULL;