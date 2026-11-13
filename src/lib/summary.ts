import { db } from './db';
import { itemCap, plaidConfigured, plaidEnv, slotsUsed } from './plaid';
import { findRecurring, merchantKey, monthlyCost } from './recurring';

const ASSET = new Set(['depository', 'investment']);
const DEBT = new Set(['credit', 'loan']);

/** Everything the home screen shows, in one read. Shared by both of you: this is a household view. */
export async function getSummary() {
  const sql = await db();
  const envName = plaidEnv();
  const items = (await sql.query(
    'SELECT id, owner_email, institution_name, status, last_synced_at FROM items WHERE plaid_env = $1 ORDER BY created_at', [envName],
  )).rows;
  const ids = items.map((i) => i.id);
  const none = ids.length === 0;

  const accounts = none ? [] : (await sql.query(
    'SELECT id, item_id, name, mask, type, subtype, current, available FROM accounts WHERE item_id = ANY($1) ORDER BY type, name', [ids],
  )).rows.map((a) => ({ ...a, current: a.current == null ? null : Number(a.current), available: a.available == null ? null : Number(a.available) }));

  const streams = none ? [] : (await sql.query(
    `SELECT id, item_id, description, merchant_name, frequency, avg_amount, last_amount, last_date, next_date, status, category
     FROM recurring WHERE item_id = ANY($1) AND direction = 'out' AND is_active AND COALESCE(status, '') <> 'TOMBSTONED'`, [ids],
  )).rows;

  const recurring = streams
    .map((s) => {
      const amount = Number(s.last_amount ?? s.avg_amount ?? 0);
      return {
        id: s.id as string,
        label: (s.merchant_name || s.description) as string,
        frequency: s.frequency as string,
        amount,
        monthly: monthlyCost(amount, s.frequency),
        lastDate: s.last_date as string | null,
        nextDate: s.next_date as string | null,
        category: s.category as string | null,
        source: 'plaid' as const,
        priceChanged: s.avg_amount != null && s.last_amount != null && Math.abs(Number(s.last_amount) - Number(s.avg_amount)) > 0.5,
      };
    })
    .filter((r) => r.amount > 0);

  // Second opinion: charges our own rules think repeat but Plaid did not list.
  const txns = none ? [] : (await sql.query(
    'SELECT id, date, name, merchant_name, amount FROM transactions WHERE item_id = ANY($1) AND NOT pending AND amount > 0', [ids],
  )).rows.map((t) => ({ id: t.id, date: t.date, name: t.name, merchant: t.merchant_name, amount: Number(t.amount) }));
  const known = new Set(streams.map((s) => merchantKey({ name: s.description, merchant: s.merchant_name })));
  const extra = findRecurring(txns)
    .filter((c) => !known.has(c.key))
    .map((c) => ({
      id: 'own:' + c.key,
      label: c.label,
      frequency: c.cadence as string,
      amount: c.amount,
      monthly: monthlyCost(c.amount, c.cadence),
      lastDate: c.lastDate as string | null,
      nextDate: c.nextDate as string | null,
      category: null as string | null,
      source: 'found' as const,
      priceChanged: c.priceChanged,
    }));

  const all = [...recurring, ...extra].sort((a, b) => b.monthly - a.monthly);
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const upcoming = all
    .filter((r) => r.nextDate && r.nextDate >= today && r.nextDate <= horizon)
    .sort((a, b) => a.nextDate!.localeCompare(b.nextDate!));

  const sum = (kinds: Set<string>) => accounts.filter((a) => kinds.has(a.type)).reduce((n, a) => n + (a.current ?? 0), 0);
  const assets = sum(ASSET);
  const debts = sum(DEBT);

  return {
    env: envName,
    configured: plaidConfigured(),
    slots: { used: await slotsUsed(sql), cap: itemCap() },
    items: items.map((i) => ({ id: i.id, name: i.institution_name, owner: i.owner_email, status: i.status, lastSynced: i.last_synced_at })),
    accounts,
    totals: { assets, debts, net: assets - debts, monthlyRecurring: all.reduce((n, r) => n + r.monthly, 0) },
    recurring: all,
    upcoming,
  };
}

export type Summary = Awaited<ReturnType<typeof getSummary>>;
