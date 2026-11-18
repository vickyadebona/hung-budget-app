/**
 * Saves bank transactions in batches. One statement per 100 rows instead of one per row:
 * on the hosted database every statement is a network round trip, and a first sync can be thousands of rows.
 */
export interface Runner {
  query(text: string, params?: unknown[]): Promise<unknown>;
}

const COLS = ['id', 'item_id', 'account_id', 'date', 'name', 'merchant_name', 'amount', 'category', 'category_detail', 'pending', 'channel', 'account_owner'];
export const BATCH = 100;

/** Rows in Plaid's own shape (transaction_id, personal_finance_category, ...). Later copies of the same id win. */
export async function upsertTransactions(sql: Runner, itemId: string, plaidRows: any[]): Promise<number> {
  const byId = new Map<string, any>();
  for (const t of plaidRows) if (t?.transaction_id) byId.set(t.transaction_id, t);
  const rows = [...byId.values()];
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const params: unknown[] = [];
    const values = chunk.map((t, r) => {
      params.push(
        t.transaction_id, itemId, t.account_id, t.date, t.name ?? '', t.merchant_name ?? null, t.amount,
        t.personal_finance_category?.primary ?? null, t.personal_finance_category?.detailed ?? null,
        t.pending === true, t.payment_channel ?? null, t.account_owner ?? null, // the cardholder, when the bank says (rare)
      );
      return '(' + COLS.map((_, c) => '$' + (r * COLS.length + c + 1)).join(',') + ')';
    });
    await sql.query(
      `INSERT INTO transactions (${COLS.join(', ')}) VALUES ${values.join(', ')}
       ON CONFLICT (id) DO UPDATE SET date = EXCLUDED.date, name = EXCLUDED.name, merchant_name = EXCLUDED.merchant_name,
         amount = EXCLUDED.amount, category = EXCLUDED.category, category_detail = EXCLUDED.category_detail,
         pending = EXCLUDED.pending, channel = EXCLUDED.channel, account_owner = EXCLUDED.account_owner`,
      params,
    );
  }
  return rows.length;
}

export async function deleteTransactions(sql: Runner, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 500) {
    await sql.query('DELETE FROM transactions WHERE id = ANY($1)', [ids.slice(i, i + 500)]);
  }
}
