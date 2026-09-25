import { sql } from 'drizzle-orm';
import {
  pgTable,
  serial,
  integer,
  text,
  date,
  numeric,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  unique,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core';

// Money is numeric(14,2) — exact decimal, never double precision. node-pg returns
// numeric as a string ("12.30"), so serializers convert explicitly (lib/money.js)
// and every sum runs in SQL rather than by float accumulation in JS.
const money = (name) => numeric(name, { precision: 14, scale: 2 });

// `date` is mode:'string' so it stays 'YYYY-MM-DD' (no node-pg local-timezone
// Date coercion that the date helpers depend on).
const day = (name) => date(name, { mode: 'string' });

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// Every tenant-owned table carries user_id; deleting a user removes all their rows.
const ownerId = () =>
  integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    // Stored trimmed + lowercased (enforced below), so the plain unique
    // constraint is effectively case-insensitive.
    email: text('email').notNull().unique(),
    // scrypt$N$r$p$salt$hash — see lib/password.js.
    password_hash: text('password_hash').notNull(),
    // sha256 hex of the personal quick-add key. The key itself is shown to the
    // user once and never stored; NULL = no key issued (or revoked).
    quick_add_key_hash: text('quick_add_key_hash').unique(),
    created_at: createdAt(),
  },
  (t) => [
    check('users_email_normalized', sql`${t.email} = lower(btrim(${t.email}))`),
    check('users_email_length_check', sql`char_length(${t.email}) <= 254`),
  ]
);

export const categories = pgTable(
  'categories',
  {
    id: serial('id').primaryKey(),
    user_id: ownerId(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    color: text('color').notNull(),
    sort_order: integer('sort_order').notNull().default(0),
    // "Delete" archives: the row stays so its transactions keep a label in
    // history and statistics, but it disappears from input forms and quick-add.
    archived_at: timestamp('archived_at', { withTimezone: true }),
    created_at: createdAt(),
  },
  (t) => [
    check('categories_kind_check', sql`${t.kind} in ('income', 'expense')`),
    check('categories_name_length_check', sql`char_length(${t.name}) between 1 and 50`),
    // Target of the composite FK from transactions, so Postgres itself
    // guarantees a transaction can only reference its own user's category.
    unique('categories_id_user_id_unique').on(t.id, t.user_id),
    // Active names are unique per user + kind, case-insensitively. Archived rows
    // are exempt so a name can be reused after archiving.
    uniqueIndex('categories_active_name_unique')
      .on(t.user_id, t.kind, sql`lower(${t.name})`)
      .where(sql`${t.archived_at} is null`),
    index('categories_user_kind_idx').on(t.user_id, t.kind),
  ]
);

// One row per recorded calendar day per user. Totals are NOT stored here — they
// are always computed from transactions; the row carries the close/open state
// and marks the day as "recorded" (streak, calendar, stats day counts).
export const days = pgTable(
  'days',
  {
    id: serial('id').primaryKey(),
    user_id: ownerId(),
    date: day('date').notNull(),
    is_closed: boolean('is_closed').notNull().default(false),
    created_at: createdAt(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('days_user_date_unique').on(t.user_id, t.date)]
);

export const transactions = pgTable(
  'transactions',
  {
    id: serial('id').primaryKey(),
    user_id: ownerId(),
    category_id: integer('category_id').notNull(),
    date: day('date').notNull(),
    amount: money('amount').notNull(),
    note: text('note'),
    source: text('source').notNull().default('manual'),
    created_at: createdAt(),
  },
  (t) => [
    // (category_id, user_id) → categories(id, user_id): a cross-tenant category
    // reference is impossible even if an app-level ownership check is missed.
    // Default NO ACTION (checked at end of statement) still lets a user delete
    // cascade through categories and transactions together.
    foreignKey({
      name: 'transactions_category_owner_fk',
      columns: [t.category_id, t.user_id],
      foreignColumns: [categories.id, categories.user_id],
    }),
    // Every transaction belongs to a recorded day: the day row must be upserted
    // before the insert and cannot be removed while entries remain. Backstop for
    // the lock-first ledger writes in lib/ledger.js.
    foreignKey({
      name: 'transactions_day_fk',
      columns: [t.user_id, t.date],
      foreignColumns: [days.user_id, days.date],
    }),
    check('transactions_amount_positive', sql`${t.amount} > 0`),
    check(
      'transactions_note_length',
      sql`${t.note} is null or char_length(${t.note}) <= 200`
    ),
    check('transactions_source_check', sql`${t.source} in ('manual', 'quick_add')`),
    index('transactions_user_date_idx').on(t.user_id, t.date),
    index('transactions_category_idx').on(t.category_id),
  ]
);

// Savings goals with progress tracking.
export const goals = pgTable(
  'goals',
  {
    id: serial('id').primaryKey(),
    user_id: ownerId(),
    title: text('title').notNull(),
    target_amount: money('target_amount').notNull(),
    current_amount: money('current_amount').notNull().default('0'),
    // Derived by Postgres from the exact numeric amounts, so it can never drift
    // from them no matter which write path touched the goal.
    achieved: boolean('achieved')
      .notNull()
      .generatedAlwaysAs(sql`target_amount > 0 and current_amount >= target_amount`),
    created_at: createdAt(),
  },
  (t) => [
    check('goals_amounts_check', sql`${t.target_amount} > 0 and ${t.current_amount} >= 0`),
    check('goals_title_length_check', sql`char_length(${t.title}) between 1 and 200`),
    index('goals_user_idx').on(t.user_id),
  ]
);
