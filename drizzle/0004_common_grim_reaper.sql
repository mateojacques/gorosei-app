CREATE TABLE "eligibility_exceptions" (
	"tournament_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"reason" text NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eligibility_exceptions_tournament_id_team_id_rule_id_pk" PRIMARY KEY("tournament_id","team_id","rule_id")
);
--> statement-breakpoint
CREATE TABLE "registration_players" (
	"registration_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"tournament_id" uuid NOT NULL,
	"riot_account_id" uuid NOT NULL,
	"is_sub" boolean NOT NULL,
	"snapshot" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "registration_players_registration_id_user_id_pk" PRIMARY KEY("registration_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eligibility_exceptions" ADD CONSTRAINT "eligibility_exceptions_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eligibility_exceptions" ADD CONSTRAINT "eligibility_exceptions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eligibility_exceptions" ADD CONSTRAINT "eligibility_exceptions_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_players" ADD CONSTRAINT "registration_players_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_players" ADD CONSTRAINT "registration_players_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_players" ADD CONSTRAINT "registration_players_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_players" ADD CONSTRAINT "registration_players_riot_account_id_riot_accounts_id_fk" FOREIGN KEY ("riot_account_id") REFERENCES "public"."riot_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "registration_players_one_active_idx" ON "registration_players" USING btree ("tournament_id","user_id") WHERE "registration_players"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_one_active_per_team_idx" ON "registrations" USING btree ("tournament_id","team_id") WHERE "registrations"."status" not in ('withdrawn', 'dropped');