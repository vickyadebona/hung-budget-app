import { db } from './db';
import { plaidEnv } from './plaid';
import { sharedAccounts } from './dedupe';
import { monthRange } from './budget-rules';

// Money moving between your own accounts: shown, but not counted as money in or out.
const MOVING = /^(TRANSFER_IN|TRANSFER_OUT|LOAN_PAYMENTS_CREDIT_CARD_PAYMENT)/;

/** Every transaction in one month (YYYY-MM), newest first. Shared accounts linked by both of you appear once. */
export async function getTransactions(month: string) {
  const sql = await db();
  const env = plaidEnv();
  const { from, to } = monthRange(month);
  const hidden = [...(await sharedAccounts(sql, env)).dup.keys()];
  const rows = (await sql.query(
    `SELECT t.id, t.date, t.name, t.merchant_name, t.amount, t.category, t.category_detail, t.pending,
            a.name AS account, a.mask, i.institution_name AS bank, i.owner_email AS owner
     FROM transactions t
     JOIN items i ON i.id = t.item_id
     LEFT JOIN accounts a ON a.id = t.account_id
     WHERE i.plaid_env = $1 AND t.date >= $2 AND t.date < $3 AND NOT (t.account_id = ANY($4))
     ORDER BY t.date DESC, t.pending DESC, t.name`,
    [env, from, to, hidden],
  )).rows;
  const transactions = rows.map((r) => ({
    id: r.id as string,
    date: r.date as string,
    name: (r.merchant_name || r.name) as string,
    description: r.name as string,
    amount: Number(r.amount), // positive = money out, like Plaid
    category: (r.category ?? null) as string | null,
    pending: r.pending === true,
    account: r.account ? `${r.account}${r.mask ? ' ··' + r.mask : ''}` : 'Account',
    bank: (r.bank ?? '') as string,
    owner: r.owner as string,
    transfer: MOVING.test(r.category_detail ?? r.category ?? ''),
  }));
  const counted = transactions.filter((t) => !t.transfer);
  return {
    month,
    transactions,
    totals: {
      out: counted.filter((t) => t.amount > 0).reduce((n, t) => n + t.amount, 0),
      in: counted.filter((t) => t.amount < 0).reduce((n, t) => n - t.amount, 0),
    },
  };
}

export type Transactions = Awaited<ReturnType<typeof getTransactions>>;
