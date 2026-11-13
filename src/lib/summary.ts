import { db } from './db';
import { itemCap, plaidConfigured, plaidEnv, slotsUsed } from './plaid';
import { findRecurring, merchantKey, monthlyCost } from './recurring';
import { appleSubscriptions } from './apple-store';
import { appleFrequency, cardState, daysUntil, needsAttention } from './cards';
import { sharedAccounts } from './dedupe';

// Bank-side lumps that the Apple receipts break down item by item.
const APPLE_BILLING = /apple\.com|itunes|apple services/i;

const ASSET = new Set(['depository', 'investment']);
const DEBT = new Set(['credit', 'loan']);

/** Everything the home screen shows, in one read. Shared by both of you: this is a household view. */
export async function getSummary() {
  const sql = await db();
  const envName = plaidEnv();
  const items = (await sql.query(
    'SELECT id, owner_email, institution_name, status, last_synced_at, liabilities FROM items WHERE plaid_env = $1 ORDER BY created_at', [envName],
  )).rows;
  const ids = items.map((i) => i.id);
  const none = ids.length === 0;

  // Accounts you both linked (joint checking, a shared card) are counted once, under the first login.
  const { dup, shared } = await sharedAccounts(sql, envName);
  const hidden = [...dup.keys()];
  const accounts = none ? [] : (await sql.query(
    'SELECT id, item_id, name, mask, type, subtype, current, available FROM accounts WHERE item_id = ANY($1) AND NOT (id = ANY($2)) ORDER BY type, name', [ids, hidden],
  )).rows.map((a) => ({
    ...a,
    current: a.current == null ? null : Number(a.current),
    available: a.available == null ? null : Number(a.available),
    shared: shared.has(a.id),
  }));

  const streams = none ? [] : (await sql.query(
    `SELECT id, item_id, description, merchant_name, frequency, avg_amount, last_amount, last_date, next_date, status, category
     FROM recurring WHERE item_id = ANY($1) AND NOT (account_id = ANY($2)) AND direction = 'out' AND is_active AND COALESCE(status, '') <> 'TOMBSTONED'`, [ids, hidden],
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
    'SELECT id, date, name, merchant_name, amount FROM transactions WHERE item_id = ANY($1) AND NOT (account_id = ANY($2)) AND NOT pending AND amount > 0', [ids, hidden],
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

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

  // Apple subscriptions from Gmail receipts. When there are any, the bank's single "Apple" charge is replaced by the real list.
  const apple = await appleSubscriptions(today);
  const appleRows = apple.map((a) => ({
    id: a.id,
    label: a.name,
    frequency: appleFrequency(a.months),
    amount: a.price,
    monthly: a.monthly,
    lastDate: a.lastCharged as string | null,
    nextDate: a.renews as string | null,
    category: null as string | null,
    source: 'apple' as const,
    priceChanged: a.previousPrice !== null && Math.abs(a.previousPrice - a.price) > 0.009,
    owner: a.owner,
    trial: a.trial,
  }));
  const bankRows = [...recurring, ...extra].filter((r) => apple.length === 0 || !APPLE_BILLING.test(r.label));
  const all = [...bankRows, ...appleRows].sort((a, b) => b.monthly - a.monthly);
  const horizon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  // Credit cards with their statement details (when the bank shares them).
  const liab = none ? [] : (await sql.query('SELECT * FROM card_liabilities WHERE item_id = ANY($1)', [ids])).rows;
  const liabBy = new Map<string, any>();
  for (const l of liab) {
    const kept = dup.get(l.account_id) ?? l.account_id; // details from the other login count for the kept account
    const prev = liabBy.get(kept);
    if (!prev || String(l.updated_at) > String(prev.updated_at)) liabBy.set(kept, l);
  }
  const num = (v: unknown) => (v == null ? null : Number(v));
  const cards = accounts
    .filter((a) => a.type === 'credit')
    .map((a) => {
      const l = liabBy.get(a.id);
      const details = l
        ? {
            next_due: l.next_due as string | null, minimum: num(l.minimum), statement_balance: num(l.statement_balance),
            statement_date: l.statement_date as string | null, last_payment: num(l.last_payment), last_payment_date: l.last_payment_date as string | null,
            is_overdue: l.is_overdue as boolean | null,
          }
        : null;
      const state = cardState(details, today);
      return { ...a, details, state, daysLeft: details?.next_due ? daysUntil(details.next_due, today) : null };
    });

  const upcoming = all
    .filter((r) => r.nextDate && r.nextDate >= today && r.nextDate <= horizon)
    .sort((a, b) => a.nextDate!.localeCompare(b.nextDate!));
  // Unpaid card statements, overdue first, then by due date. Shown in their own section.
  const cardDue = cards
    .filter((c) => c.details?.next_due && (c.state === 'due' || c.state === 'due-soon' || c.state === 'overdue'))
    .sort((a, b) => a.details!.next_due!.localeCompare(b.details!.next_due!))
    .map((c) => ({
      accountId: c.id,
      name: `${c.name}${c.mask ? ' ··' + c.mask : ''}`,
      bank: items.find((i) => i.id === c.item_id)?.institution_name ?? '',
      state: c.state,
      due: c.details!.next_due!,
      daysLeft: c.daysLeft,
      minimum: c.details!.minimum ?? 0,
      statement: c.details!.statement_balance,
    }));
  const cardNotices = cards
    .filter((c) => needsAttention(c.state))
    .map((c) => ({ accountId: c.id, name: `${c.name}${c.mask ? ' ··' + c.mask : ''}`, state: c.state, minimum: c.details?.minimum ?? null, due: c.details?.next_due ?? null, daysLeft: c.daysLeft }));

  const sum = (kinds: Set<string>) => accounts.filter((a) => kinds.has(a.type)).reduce((n, a) => n + (a.current ?? 0), 0);
  const assets = sum(ASSET);
  const debts = sum(DEBT);

  return {
    env: envName,
    configured: plaidConfigured(),
    slots: { used: await slotsUsed(sql), cap: itemCap() },
    items: items.map((i) => ({ id: i.id, name: i.institution_name, owner: i.owner_email, status: i.status, lastSynced: i.last_synced_at, liabilities: (i.liabilities ?? null) as string | null })),
    accounts,
    bank: accounts.filter((a) => a.type === 'depository'),
    investments: accounts.filter((a) => a.type === 'investment'),
    loans: accounts.filter((a) => a.type === 'loan'),
    cards,
    cardNotices,
    cardDue,
    appleCount: apple.length,
    totals: { assets, debts, net: assets - debts, monthlyRecurring: all.reduce((n, r) => n + r.monthly, 0) },
    recurring: all,
    upcoming,
  };
}

export type Summary = Awaited<ReturnType<typeof getSummary>>;
