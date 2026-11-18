CREATE TABLE `wishlist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`title` text NOT NULL,
	`price` text DEFAULT '' NOT NULL,
	`image_url` text DEFAULT '' NOT NULL,
	`product_url` text DEFAULT '' NOT NULL,
	`store` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wishlist_items_member_idx` ON `wishlist_items` (`member_id`);