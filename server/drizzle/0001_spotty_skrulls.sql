CREATE TABLE IF NOT EXISTS "goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"target_amount" double precision DEFAULT 0 NOT NULL,
	"current_amount" double precision DEFAULT 0 NOT NULL,
	"achieved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "days" ADD COLUMN IF NOT EXISTS "expense_health" double precision DEFAULT 0 NOT NULL;