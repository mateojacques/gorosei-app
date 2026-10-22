CREATE TABLE "brackets" (
	"tournament_id" uuid PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"stage_id" integer NOT NULL,
	"final_standings" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_ins" (
	"registration_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"tournament_id" uuid NOT NULL,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_user_id" text,
	CONSTRAINT "check_ins_registration_id_user_id_pk" PRIMARY KEY("registration_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "match_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"author_user_id" text,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_reports" (
	"match_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"score1" integer NOT NULL,
	"score2" integer NOT NULL,
	"screenshot_url" text,
	"riot_match_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_reports_match_id_registration_id_pk" PRIMARY KEY("match_id","registration_id")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"bm_match_id" integer NOT NULL,
	"phase" text NOT NULL,
	"group_no" integer NOT NULL,
	"round_no" integer NOT NULL,
	"number" integer NOT NULL,
	"best_of" integer NOT NULL,
	"reg1_id" uuid,
	"reg2_id" uuid,
	"status" text DEFAULT 'waiting' NOT NULL,
	"lobby_name" text,
	"lobby_password" text,
	"lobby_posted_by" text,
	"opened_at" timestamp with time zone,
	"score1" integer,
	"score2" integer,
	"winner_reg_id" uuid,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"riot_match_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stats" jsonb
);
--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "check_in_decision" text;--> statement-breakpoint
ALTER TABLE "brackets" ADD CONSTRAINT "brackets_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_by_user_id_user_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_messages" ADD CONSTRAINT "match_messages_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_messages" ADD CONSTRAINT "match_messages_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_reports" ADD CONSTRAINT "match_reports_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_reports" ADD CONSTRAINT "match_reports_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_reg1_id_registrations_id_fk" FOREIGN KEY ("reg1_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_reg2_id_registrations_id_fk" FOREIGN KEY ("reg2_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_lobby_posted_by_user_id_fk" FOREIGN KEY ("lobby_posted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_reg_id_registrations_id_fk" FOREIGN KEY ("winner_reg_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_messages_match_idx" ON "match_messages" USING btree ("match_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_tournament_bm_idx" ON "matches" USING btree ("tournament_id","bm_match_id");--> statement-breakpoint
CREATE INDEX "matches_status_idx" ON "matches" USING btree ("status");