CREATE TYPE "public"."channel_type" AS ENUM('api', 'telegram', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('disconnected', 'connecting', 'qr', 'connected', 'error');--> statement-breakpoint
CREATE TYPE "public"."contact_scope" AS ENUM('direct', 'group');--> statement-breakpoint
CREATE TYPE "public"."contact_status" AS ENUM('pending', 'approved', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'sending', 'sent', 'failed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."inbox_status" AS ENUM('pending', 'submitted', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."provider_kind" AS ENUM('openai', 'anthropic', 'google');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'completed', 'failed', 'interrupted', 'cancelled');--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"content" text NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_auth" (
	"channel_id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"chunks" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_connections" (
	"channel_id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"desired" boolean NOT NULL,
	"generation" integer NOT NULL,
	"fence" integer,
	"status" "connection_status" NOT NULL,
	"owner" text,
	"lease_until" bigint,
	"retry_at" bigint,
	"account_id" text,
	"session_saved_at" timestamp with time zone,
	"error" text,
	"qr" jsonb,
	"qr_expires_at" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_inbox" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"message" jsonb NOT NULL,
	"status" "inbox_status" NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"type" "channel_type" NOT NULL,
	"address" text,
	"webhook_token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "checkpoints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"scope" "contact_scope" NOT NULL,
	"chat_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"title" text,
	"status" "contact_status" NOT NULL,
	"session_id" uuid,
	"held_message" jsonb,
	"held_message_id" text,
	"agent_turns" integer DEFAULT 0 NOT NULL,
	"seen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"run_id" uuid,
	"chat_id" text NOT NULL,
	"notice" text,
	"status" "delivery_status" NOT NULL,
	"error" text,
	"remote_message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"connection_generation" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"run_id" uuid,
	"type" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leases" (
	"profile_id" uuid NOT NULL,
	"resource" text NOT NULL,
	"session_id" uuid NOT NULL,
	"fence" bigserial NOT NULL,
	"expires_at" bigint NOT NULL,
	CONSTRAINT "leases_profile_id_resource_pk" PRIMARY KEY("profile_id","resource")
);
--> statement-breakpoint
CREATE TABLE "mail" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"from_session_id" uuid NOT NULL,
	"to_session_id" uuid NOT NULL,
	"text" text NOT NULL,
	"request_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"profile_id" uuid NOT NULL,
	"key" text NOT NULL,
	"content" text NOT NULL,
	"version" integer NOT NULL,
	"source_session_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memories_profile_id_key_pk" PRIMARY KEY("profile_id","key")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_defaults" (
	"profile_id" uuid NOT NULL,
	"role" text NOT NULL,
	"provider_id" uuid,
	"model_id" text,
	"reasoning_effort" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_defaults_profile_id_role_pk" PRIMARY KEY("profile_id","role")
);
--> statement-breakpoint
CREATE TABLE "profile_revisions" (
	"profile_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_revisions_profile_id_version_pk" PRIMARY KEY("profile_id","version")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"instructions" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"avatar" text,
	"model" jsonb NOT NULL,
	"identity" jsonb NOT NULL,
	"context_policy" jsonb NOT NULL,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mcp_servers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allow_self_management" boolean DEFAULT false NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "provider_kind" NOT NULL,
	"auth_mode" text,
	"api_key_env" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"profile_version" integer NOT NULL,
	"request_key" text NOT NULL,
	"input" text NOT NULL,
	"status" "run_status" NOT NULL,
	"output" text,
	"error" text,
	"usage" jsonb,
	"continuation_of" uuid,
	"model" jsonb,
	"model_selection" jsonb,
	"context_policy" jsonb,
	"call" jsonb,
	"group_turn" jsonb,
	"lease_owner" text,
	"lease_until" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"profile_id" uuid NOT NULL,
	"name" text NOT NULL,
	"envelope" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secrets_profile_id_name_pk" PRIMARY KEY("profile_id","name")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"title" text NOT NULL,
	"channel" text NOT NULL,
	"peer_profile_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_auth" ADD CONSTRAINT "channel_auth_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_auth" ADD CONSTRAINT "channel_auth_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_inbox" ADD CONSTRAINT "channel_inbox_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_inbox" ADD CONSTRAINT "channel_inbox_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail" ADD CONSTRAINT "mail_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail" ADD CONSTRAINT "mail_from_session_id_sessions_id_fk" FOREIGN KEY ("from_session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail" ADD CONSTRAINT "mail_to_session_id_sessions_id_fk" FOREIGN KEY ("to_session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_source_session_id_sessions_id_fk" FOREIGN KEY ("source_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_defaults" ADD CONSTRAINT "model_defaults_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_revisions" ADD CONSTRAINT "profile_revisions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_peer_profile_id_profiles_id_fk" FOREIGN KEY ("peer_profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifacts_run" ON "artifacts" USING btree ("run_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "channel_inbox_pending" ON "channel_inbox" USING btree ("channel_id","status","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_live_per_type" ON "channels" USING btree ("profile_id","type") WHERE "channels"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "channels_webhook_token" ON "channels" USING btree ("webhook_token_hash");--> statement-breakpoint
CREATE INDEX "checkpoints_run" ON "checkpoints" USING btree ("run_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_identity" ON "contacts" USING btree ("channel_id","chat_id","actor_id");--> statement-breakpoint
CREATE INDEX "contacts_pending" ON "contacts" USING btree ("profile_id","status");--> statement-breakpoint
CREATE INDEX "deliveries_recent" ON "deliveries" USING btree ("profile_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "deliveries_phase" ON "deliveries" USING btree ("channel_id","status","created_at");--> statement-breakpoint
CREATE INDEX "events_cursor" ON "events" USING btree ("profile_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_request_key" ON "mail" USING btree ("profile_id","from_session_id","request_key");--> statement-breakpoint
CREATE INDEX "mail_inbox" ON "mail" USING btree ("to_session_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "memories_recent" ON "memories" USING btree ("profile_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "memories_search" ON "memories" USING gin (to_tsvector('simple', "key" || ' ' || "content"));--> statement-breakpoint
CREATE INDEX "messages_session" ON "messages" USING btree ("session_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_profile" ON "messages" USING btree ("profile_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_search" ON "messages" USING gin (to_tsvector('simple', "content"));--> statement-breakpoint
CREATE INDEX "profile_revisions_recent" ON "profile_revisions" USING btree ("profile_id","version" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "providers_live_per_kind" ON "providers" USING btree ("profile_id","kind") WHERE "providers"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "runs_request_key" ON "runs" USING btree ("profile_id","session_id","request_key");--> statement-breakpoint
CREATE INDEX "runs_activity" ON "runs" USING btree ("profile_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "runs_running" ON "runs" USING btree ("status") WHERE "runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "runs_queued" ON "runs" USING btree ("status") WHERE "runs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "runs_session" ON "runs" USING btree ("profile_id","session_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sessions_recent" ON "sessions" USING btree ("profile_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sessions_peer" ON "sessions" USING btree ("profile_id","peer_profile_id");