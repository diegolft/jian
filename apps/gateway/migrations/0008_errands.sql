CREATE TYPE "public"."errand_status" AS ENUM('waiting', 'answered', 'expired');--> statement-breakpoint
CREATE TABLE "errands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"from_session_id" uuid NOT NULL,
	"question" text NOT NULL,
	"status" "errand_status" NOT NULL,
	"answer" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "errands" ADD CONSTRAINT "errands_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "errands" ADD CONSTRAINT "errands_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "errands" ADD CONSTRAINT "errands_from_session_id_sessions_id_fk" FOREIGN KEY ("from_session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "errands_open_per_contact" ON "errands" USING btree ("contact_id") WHERE "errands"."status" = 'waiting';--> statement-breakpoint
CREATE INDEX "errands_waiting" ON "errands" USING btree ("profile_id","status");