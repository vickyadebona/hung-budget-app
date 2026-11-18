import { db, firstName } from './db';
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
  const { dup, shared } = await sharedAccounts(sql, env);
  const hidden = [...dup.keys()];
  const names = new Map<string, string>((await sql.query('SELECT email, name FROM people')).rows.map((p) => [p.email as string, p.name as string]));
  const rows = (await sql.query(
    `SELECT t.id, t.date, t.name, t.merchant_name, t.amount, t.category, t.category_detail, t.pending, t.account_id, t.account_owner,
            a.name AS account, a.mask, i.institution_name AS bank, i.owner_email AS owner
     FROM transactions t
     JOIN items i ON i.id = t.item_id
     LEFT JOIN accounts a ON a.id = t.account_id
     WHERE i.plaid_env = $1 AND t.date >= $2 AND t.date < $3 AND NOT (t.account_id = ANY($4))
     ORDER BY t.date DESC, t.pending DESC, t.name`,
    [env, from, to, hidden],
  )).rows;
  // Who made it: the cardholder when the bank says; otherwise whoever linked the account, or "Joint" for an
  // account you both linked (the bank does not say which of you used a joint account).
  const whoOf = (r: any): { key: string; name: string } =>
    r.account_owner ? { key: 'holder:' + String(r.account_owner).toLowerCase(), name: String(r.account_owner) }
    : shared.has(r.account_id) ? { key: 'joint', name: 'Joint' }
    : { key: r.owner, name: firstName(r.owner, names.get(r.owner)) };
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
    who: whoOf(r),
    transfer: MOVING.test(r.category_detail ?? r.category ?? ''),
  }));
  const counted = transactions.filter((t) => !t.transfer);
  const people = [...new Map(transactions.map((t) => [t.who.key, t.who])).values()].sort((a, b) => (a.key === 'joint' ? 1 : b.key === 'joint' ? -1 : a.name.localeCompare(b.name)));
  return {
    month,
    transactions,
    people,
    totals: {
      out: counted.filter((t) => t.amount > 0).reduce((n, t) => n + t.amount, 0),
      in: counted.filter((t) => t.amount < 0).reduce((n, t) => n - t.amount, 0),
    },
  };
}

export type Transactions = Awaited<ReturnType<typeof getTransactions>>;
