CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "rank_overrides" (
	"riot_account_id" uuid PRIMARY KEY NOT NULL,
	"tier" text NOT NULL,
	"division" text NOT NULL,
	"reason" text NOT NULL,
	"set_by" text NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rank_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"riot_account_id" uuid NOT NULL,
	"tier" text,
	"division" text,
	"lp" integer,
	"wins" integer NOT NULL,
	"losses" integer NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "riot_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"puuid" text NOT NULL,
	"game_name" text NOT NULL,
	"tag_line" text NOT NULL,
	"summoner_level" integer NOT NULL,
	"profile_icon_id" integer NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_polled_at" timestamp with time zone,
	CONSTRAINT "riot_accounts_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "riot_accounts_puuid_unique" UNIQUE("puuid")
);
--> statement-breakpoint
CREATE TABLE "riot_link_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"puuid" text NOT NULL,
	"game_name" text NOT NULL,
	"tag_line" text NOT NULL,
	"required_icon_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "riot_link_challenges_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rank_overrides" ADD CONSTRAINT "rank_overrides_riot_account_id_riot_accounts_id_fk" FOREIGN KEY ("riot_account_id") REFERENCES "public"."riot_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_overrides" ADD CONSTRAINT "rank_overrides_set_by_user_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_snapshots" ADD CONSTRAINT "rank_snapshots_riot_account_id_riot_accounts_id_fk" FOREIGN KEY ("riot_account_id") REFERENCES "public"."riot_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riot_accounts" ADD CONSTRAINT "riot_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riot_link_challenges" ADD CONSTRAINT "riot_link_challenges_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rank_snapshots_account_observed_idx" ON "rank_snapshots" USING btree ("riot_account_id","observed_at");