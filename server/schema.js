import {
  pgTable,
  serial,
  text,
  date,
  doublePrecision,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';

// One running total per category, per calendar day — the original SQLite model,
// preserved verbatim. Money is `double precision` (not numeric) so node-postgres
// returns JS numbers, keeping the existing `income_main + income_tips` arithmetic
// working unchanged. `date` is mode:'string' so it stays 'YYYY-MM-DD' (no node-pg
// local-timezone Date coercion that the date helpers depend on).
export const days = pgTable('days', {
  id: serial('id').primaryKey(),
  date: date('date', { mode: 'string' }).notNull().unique(),
  income_main: doublePrecision('income_main').notNull().default(0),
  income_tips: doublePrecision('income_tips').notNull().default(0),
  expense_food_out: doublePrecision('expense_food_out').notNull().default(0),
  expense_food_market: doublePrecision('expense_food_market').notNull().default(0),
  expense_no_reason: doublePrecision('expense_no_reason').notNull().default(0),
  expense_gas: doublePrecision('expense_gas').notNull().default(0),
  expense_wants: doublePrecision('expense_wants').notNull().default(0),
  expense_health: doublePrecision('expense_health').notNull().default(0),
  is_closed: boolean('is_closed').notNull().default(false),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Savings goals with progress tracking (Feature 3).
export const goals = pgTable('goals', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  target_amount: doublePrecision('target_amount').notNull().default(0),
  current_amount: doublePrecision('current_amount').notNull().default(0),
  achieved: boolean('achieved').notNull().default(false),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
