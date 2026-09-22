CREATE TABLE "gateway_secrets" (
	"name" text PRIMARY KEY NOT NULL,
	"envelope" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "providers" DROP CONSTRAINT "providers_profile_id_profiles_id_fk";
--> statement-breakpoint
DROP INDEX "providers_live_per_kind";--> statement-breakpoint
CREATE UNIQUE INDEX "providers_live_per_kind" ON "providers" USING btree ("kind") WHERE "providers"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE "providers" DROP COLUMN "profile_id";