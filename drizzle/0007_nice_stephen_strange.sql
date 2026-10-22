CREATE TABLE "pool_entries" (
	"tournament_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"riot_account_id" uuid NOT NULL,
	"roles" jsonb NOT NULL,
	"auto_place" boolean DEFAULT true NOT NULL,
	"snapshot" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pool_entries_tournament_id_user_id_pk" PRIMARY KEY("tournament_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "pool_entries" ADD CONSTRAINT "pool_entries_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_entries" ADD CONSTRAINT "pool_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_entries" ADD CONSTRAINT "pool_entries_riot_account_id_riot_accounts_id_fk" FOREIGN KEY ("riot_account_id") REFERENCES "public"."riot_accounts"("id") ON DELETE no action ON UPDATE no action;