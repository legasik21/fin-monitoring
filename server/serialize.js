// Maps a Drizzle `days` row to the exact JSON shape the existing client expects:
//  - money columns as JS numbers
//  - is_closed as 0 | 1 (the client compares `row.is_closed === 1` / `=== 0`)
//  - date as a 'YYYY-MM-DD' string
// This keeps the entire pre-existing client contract byte-for-byte while the DB
// stores is_closed as a real boolean.
export function serializeDay(row) {
  if (!row) return row;
  return {
    id: row.id,
    date:
      typeof row.date === 'string'
        ? row.date.slice(0, 10)
        : new Date(row.date).toISOString().slice(0, 10),
    income_main: Number(row.income_main),
    income_tips: Number(row.income_tips),
    expense_food_out: Number(row.expense_food_out),
    expense_food_market: Number(row.expense_food_market),
    expense_no_reason: Number(row.expense_no_reason),
    expense_gas: Number(row.expense_gas),
    expense_wants: Number(row.expense_wants),
    expense_health: Number(row.expense_health),
    is_closed: row.is_closed ? 1 : 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
