CREATE TABLE "tournament_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" text NOT NULL,
	"registration_opens_days_before" integer NOT NULL,
	"registration_closes_minutes_before" integer NOT NULL,
	"next_edition" integer NOT NULL,
	"active" boolean NOT NULL,
	"bracket" text NOT NULL,
	"draft_mode" text NOT NULL,
	"best_of" integer NOT NULL,
	"finals_best_of" integer NOT NULL,
	"team_cap" integer NOT NULL,
	"max_subs" integer NOT NULL,
	"subs_count_for_team_rules" boolean NOT NULL,
	"rank_source" text NOT NULL,
	"eligibility_rules" jsonb NOT NULL,
	"entry_fee_ars" integer NOT NULL,
	"prize_goal_ars" integer NOT NULL,
	"prize_split" jsonb NOT NULL,
	"payment_instructions" text NOT NULL,
	"rules_text" text NOT NULL,
	"stream_url" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "tournament_templates" ADD CONSTRAINT "tournament_templates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_template_id_tournament_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."tournament_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tournaments_template_starts_at_idx" ON "tournaments" USING btree ("template_id","starts_at");