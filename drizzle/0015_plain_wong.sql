ALTER TABLE "tournaments" ADD COLUMN "riot_tournament_id" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "tournament_code" text;