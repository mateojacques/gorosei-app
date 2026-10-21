CREATE TABLE "entry_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"source_tournament_id" uuid,
	"reason" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"used_payment_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entry_credits" ADD CONSTRAINT "entry_credits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_credits" ADD CONSTRAINT "entry_credits_source_tournament_id_tournaments_id_fk" FOREIGN KEY ("source_tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_credits" ADD CONSTRAINT "entry_credits_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entry_credits_user_source_idx" ON "entry_credits" USING btree ("user_id","source_tournament_id");--> statement-breakpoint
ALTER TABLE "entry_payments" ADD CONSTRAINT "entry_payments_credit_id_entry_credits_id_fk" FOREIGN KEY ("credit_id") REFERENCES "public"."entry_credits"("id") ON DELETE no action ON UPDATE no action;