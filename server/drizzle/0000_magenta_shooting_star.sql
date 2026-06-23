CREATE TABLE "days" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"income_main" double precision DEFAULT 0 NOT NULL,
	"income_tips" double precision DEFAULT 0 NOT NULL,
	"expense_food_out" double precision DEFAULT 0 NOT NULL,
	"expense_food_market" double precision DEFAULT 0 NOT NULL,
	"expense_no_reason" double precision DEFAULT 0 NOT NULL,
	"expense_gas" double precision DEFAULT 0 NOT NULL,
	"expense_wants" double precision DEFAULT 0 NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "days_date_unique" UNIQUE("date")
);
