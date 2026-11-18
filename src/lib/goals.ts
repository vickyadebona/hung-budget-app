import { db } from './db';
import { plaidEnv } from './plaid';
import { sharedAccounts } from './dedupe';
import { allocate, cleanGoal, progress, type GoalInput, type Progress } from './goals-math';

export interface Goal extends Progress {
  id: string;
  name: string;
  target: number;
  targetDate: string | null;
  accountId: string | null;
  accountName: string | null;
  fromAccount: number; // the part of the linked account's balance that counts here
  manual: number; // set-asides you logged by hand
  entries: { id: string; amount: number; note: string; date: string; by: string }[];
}

export interface SavingsAccount {
  id: string;
  label: string;
  balance: number | null;
  extra: number; // balance not claimed by any goal
}

const today = () => new Date().toISOString().slice(0, 10);

export async function getGoals(): Promise<{ goals: Goal[]; accounts: SavingsAccount[] }> {
  const sql = await db();
  const { dup } = await sharedAccounts(sql, plaidEnv());
  const hidden = [...dup.keys()];

  const accts = (await sql.query(
    `SELECT a.id, a.name, a.mask, a.subtype, a.current, i.institution_name
     FROM accounts a JOIN items i ON i.id = a.item_id
     WHERE i.plaid_env = $1 AND a.type = 'depository' AND NOT (a.id = ANY($2)) ORDER BY i.institution_name, a.name`,
    [plaidEnv(), hidden],
  )).rows.map((a) => ({
    id: a.id as string,
    label: `${a.institution_name} ${a.name}${a.mask ? ' ····' + a.mask : ''}`,
    balance: a.current == null ? null : Number(a.current),
    subtype: a.subtype as string | null,
  }));
  const byId = new Map(accts.map((a) => [a.id, a]));

  const rows = (await sql.query('SELECT id, name, target, target_date, account_id FROM goals ORDER BY created_at, id')).rows;
  const entries = (await sql.query('SELECT id, goal_id, amount, note, date, by_email FROM goal_entries ORDER BY date DESC, id DESC')).rows;

  // Fill each linked account's goals in order.
  const perAccount = new Map<string, { id: string; target: number }[]>();
  for (const g of rows) {
    if (g.account_id && byId.has(g.account_id)) (perAccount.get(g.account_id) ?? perAccount.set(g.account_id, []).get(g.account_id)!).push({ id: g.id, target: Number(g.target) });
  }
  const fromAccount = new Map<string, number>();
  const extraByAccount = new Map<string, number>();
  for (const [id, list] of perAccount) {
    const { alloc, extra } = allocate(byId.get(id)!.balance ?? 0, list);
    for (const [gid, v] of alloc) fromAccount.set(gid, v);
    extraByAccount.set(id, extra);
  }

  const t = today();
  const goals: Goal[] = rows.map((g) => {
    const mine = entries.filter((e) => e.goal_id === g.id).map((e) => ({ id: e.id as string, amount: Number(e.amount), note: (e.note ?? '') as string, date: e.date as string, by: e.by_email as string }));
    const manual = mine.reduce((s, e) => s + e.amount, 0);
    const linked = g.account_id ? byId.get(g.account_id) : undefined;
    const fa = fromAccount.get(g.id) ?? 0;
    const target = Number(g.target);
    return {
      id: g.id, name: g.name, target, targetDate: g.target_date ?? null,
      accountId: g.account_id ?? null, accountName: linked?.label ?? null,
      fromAccount: fa, manual: Math.round(manual * 100) / 100, entries: mine.slice(0, 20),
      ...progress(target, fa + manual, g.target_date ?? null, t),
    };
  });

  const accounts: SavingsAccount[] = accts.map((a) => ({ id: a.id, label: a.label, balance: a.balance, extra: extraByAccount.get(a.id) ?? Math.max(0, a.balance ?? 0) }));
  // Savings accounts first, since that is what a goal usually points at.
  accounts.sort((x, y) => Number(accts.find((a) => a.id === y.id)?.subtype === 'savings') - Number(accts.find((a) => a.id === x.id)?.subtype === 'savings'));
  return { goals, accounts };
}

const id = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

export async function saveGoal(input: GoalInput): Promise<string | null> {
  const c = cleanGoal(input);
  if (typeof c === 'string') return c;
  const sql = await db();
  if (input.id) {
    await sql.query('UPDATE goals SET name=$2, target=$3, target_date=$4, account_id=$5 WHERE id=$1', [input.id, c.name, c.target, c.targetDate, c.accountId]);
  } else {
    await sql.query('INSERT INTO goals (id, name, target, target_date, account_id, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [id(), c.name, c.target, c.targetDate, c.accountId, new Date().toISOString()]);
  }
  return null;
}

export async function deleteGoal(goalId: string) {
  const sql = await db();
  await sql.query('DELETE FROM goal_entries WHERE goal_id = $1', [goalId]);
  await sql.query('DELETE FROM goals WHERE id = $1', [goalId]);
}

export async function addEntry(goalId: string, amount: number, note: string, by: string): Promise<string | null> {
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100_000_000) return 'Enter an amount';
  const sql = await db();
  const ok = (await sql.query('SELECT 1 FROM goals WHERE id = $1', [goalId])).rows.length;
  if (!ok) return 'Goal not found';
  await sql.query('INSERT INTO goal_entries (id, goal_id, amount, note, date, by_email) VALUES ($1,$2,$3,$4,$5,$6)', [id(), goalId, Math.round(amount * 100) / 100, note.slice(0, 100), today(), by]);
  return null;
}

export async function deleteEntry(entryId: string) {
  const sql = await db();
  await sql.query('DELETE FROM goal_entries WHERE id = $1', [entryId]);
}
