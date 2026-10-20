ALTER TABLE "app_installations" ADD COLUMN "trust" text;--> statement-breakpoint
UPDATE "app_installations" SET "trust" = CASE WHEN "bundled" THEN 'bundled' ELSE 'unsigned' END;--> statement-breakpoint
ALTER TABLE "app_installations" ALTER COLUMN "trust" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "app_installations" ADD COLUMN "publisher" text;--> statement-breakpoint
ALTER TABLE "app_installations" ADD COLUMN "key_fingerprint" text;--> statement-breakpoint
ALTER TABLE "app_installations" ADD COLUMN "managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_installations" DROP COLUMN "unsigned";
