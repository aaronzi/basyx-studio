CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" text,
	"actor_subject" text,
	"action" text NOT NULL,
	"target_id" text,
	"downstream_identity" text,
	"outcome" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "infrastructures" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"endpoints" jsonb NOT NULL,
	"security" jsonb NOT NULL,
	"secret_ciphertext" text,
	"allow_private_network" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oidc_transactions" (
	"state" text PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"session_id" text,
	"target_id" text,
	"code_verifier_ciphertext" text NOT NULL,
	"nonce" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"return_to" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"display_name" text NOT NULL,
	"roles" jsonb NOT NULL,
	"csrf_token" text NOT NULL,
	"id_token_ciphertext" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "target_credentials" (
	"session_id" text NOT NULL,
	"target_id" text NOT NULL,
	"access_token_ciphertext" text NOT NULL,
	"refresh_token_ciphertext" text,
	"access_token_expires_at" timestamp with time zone,
	"subject" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "target_credentials_session_id_target_id_pk" PRIMARY KEY("session_id","target_id")
);
--> statement-breakpoint
ALTER TABLE "oidc_transactions" ADD CONSTRAINT "oidc_transactions_session_id_studio_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."studio_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_transactions" ADD CONSTRAINT "oidc_transactions_target_id_infrastructures_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."infrastructures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_credentials" ADD CONSTRAINT "target_credentials_session_id_studio_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."studio_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_credentials" ADD CONSTRAINT "target_credentials_target_id_infrastructures_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."infrastructures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "studio_sessions_expires_at_idx" ON "studio_sessions" USING btree ("expires_at");