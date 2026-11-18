import { db } from './db';
import { itemCap, plaidConfigured, plaidEnv, slotsUsed } from './plaid';
import { findRecurring, merchantKey, monthlyCost } from './recurring';
import { appleSubscriptions } from './apple-store';
import { linkSubscriptionsFor } from './link-store';
import { linkFrequency, sameMerchant } from './link';
import { appleFrequency, cardState, cleanAprs, daysUntil, deferralPlans, interestCharged, needsAttention, zeroAprs, type Deferral, type DeferralKind, type DeferralPlan } from './cards';
import { sharedAccounts } from './dedupe';
import { judge, MARKS, type Mark } from './subscriptions';

// Bank-side lumps that the Apple receipts break down item by item.
// Bank-side charges that are really Apple. Plaid often names these just "Apple"; PayPal shows "PAYPAL *APPLE.COM BILL".
// (Written so "Applebee's" does not match.)
const APPLE_BILLING = /apple\.com|\bitunes\b|apple services|^apple(\s|$|\.)/i;

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
        description: s.description as string,
        frequency: s.frequency as string,
        amount,
        monthly: monthlyCost(amount, s.frequency),
        lastDate: s.last_date as string | null,
        nextDate: s.next_date as string | null,
        category: s.category as string | null,
        source: 'plaid' as const,
        priceChanged: s.avg_amount != null && s.last_amount != null && Math.abs(Number(s.last_amount) - Number(s.avg_amount)) > 0.5,
        previousAmount: s.avg_amount == null ? null : Number(s.avg_amount) as number | null, // Plaid gives the average, not the last-but-one
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
      previousAmount: c.previousAmount as number | null,
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
    previousAmount: a.previousPrice as number | null,
    owner: a.owner,
    trial: a.trial,
  }));
  // Link subscriptions from Gmail. The same charge also comes through the bank, so the bank's copy is dropped.
  const link = await linkSubscriptionsFor(today);
  const linkRows = link.map((s) => ({
    id: `link:${s.owner}:${s.key}`,
    label: s.name,
    frequency: linkFrequency(s.months, s.cadence),
    amount: s.price,
    monthly: s.months ? s.price / s.months : s.price,
    lastDate: s.lastCharged as string | null,
    nextDate: s.next as string | null,
    category: null as string | null,
    source: 'link' as const,
    priceChanged: s.previousPrice !== null,
    previousAmount: s.previousPrice as number | null,
    owner: s.owner,
  }));
  const isApple = (r: { label: string; description?: string }) => APPLE_BILLING.test(r.label) || APPLE_BILLING.test(r.description ?? '');
  const bankRows = [...recurring, ...extra]
    .filter((r) => apple.length === 0 || !isApple(r))
    .filter((r) => !link.some((s) => s.key !== 'unassociated' && sameMerchant(r.label, s.name)));

  // Your marks (cancelled, yearly, still active...) and our own guesses: switched to yearly, or stopped charging.
  const marks = new Map<string, Mark>(
    (await sql.query('SELECT key, mark FROM subscription_marks')).rows
      .filter((m) => (MARKS as string[]).includes(m.mark))
      .map((m) => [m.key as string, m.mark as Mark]),
  );
  const chargesByKey = new Map<string, { date: string; amount: number }[]>();
  for (const t of txns) {
    const k = merchantKey({ name: t.name, merchant: t.merchant });
    (chargesByKey.get(k) ?? chargesByKey.set(k, []).get(k)!).push({ date: t.date, amount: t.amount });
  }
  const judged = judge([...bankRows, ...appleRows, ...linkRows], marks, chargesByKey, today);
  const all = judged.filter((r) => r.status === 'active').sort((a, b) => b.monthly - a.monthly);
  const possiblyCancelled = judged.filter((r) => r.status === 'possibly-cancelled').sort((a, b) => (b.lastDate ?? '').localeCompare(a.lastDate ?? ''));
  const stopped = judged.filter((r) => r.status === 'cancelled' || r.status === 'hidden').sort((a, b) => a.label.localeCompare(b.label));
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
  // 0% and deferred amounts you typed in. One set on the other login's copy of a shared card still counts.
  const deferralRows = (await sql.query('SELECT id, account_id, kind, label, amount, ends FROM card_deferrals ORDER BY ends')).rows;
  const deferralsBy = new Map<string, Deferral[]>();
  for (const r of deferralRows) {
    const acct = dup.get(r.account_id) ?? r.account_id;
    (deferralsBy.get(acct) ?? deferralsBy.set(acct, []).get(acct)!).push({
      id: r.id, kind: r.kind as DeferralKind, label: r.label ?? '', amount: r.amount == null ? null : Number(r.amount), ends: r.ends,
    });
  }

  const cards = accounts
    .filter((a) => a.type === 'credit')
    .map((a) => {
      const l = liabBy.get(a.id);
      const aprs = cleanAprsStored(l?.aprs);
      const zero = zeroAprs(aprs);
      const zeroBalance = zero.some((z) => z.balance !== null) ? zero.reduce((n, z) => n + (z.balance ?? 0), 0) : null;
      const details = l
        ? {
            next_due: l.next_due as string | null, minimum: num(l.minimum), statement_balance: num(l.statement_balance),
            statement_date: l.statement_date as string | null, last_payment: num(l.last_payment), last_payment_date: l.last_payment_date as string | null,
            is_overdue: l.is_overdue as boolean | null,
          }
        : null;
      const state = cardState(details, today);
      return {
        ...a, details, state, daysLeft: details?.next_due ? daysUntil(details.next_due, today) : null,
        aprs,
        zeroAprs: zero,
        interestLastStatement: l ? interestCharged(aprs) : null,
        zeroBalance,
        deferrals: deferralPlans(deferralsBy.get(a.id) ?? [], today, zeroBalance, a.current),
      };
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
  // 0% offers ending within 60 days (or already ended and still owing).
  const promoNotices = cards
    .flatMap((c) => (c.deferrals.plans as DeferralPlan[])
      .filter((p) => p.level !== 'ok' && p.balance > 0)
      .map((p) => ({ accountId: c.id, name: `${c.name}${c.mask ? ' ··' + c.mask : ''}`, ...p })))
    .sort((a, b) => a.daysLeft - b.daysLeft);
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
    promoNotices,
    appleCount: apple.length,
    linkCount: link.length,
    totals: { assets, debts, net: assets - debts, monthlyRecurring: all.reduce((n, r) => n + r.monthly, 0) },
    recurring: all,
    possiblyCancelled,
    stopped,
    upcoming,
  };
}

/** Rows read back from the database are already cleaned, but older rows may hold nothing. */
function cleanAprsStored(v: unknown) {
  const raw = typeof v === 'string' ? JSON.parse(v) : v;
  if (!Array.isArray(raw)) return [];
  // stored shape is { type, pct, balance, interest }; reuse the same checks by mapping to Plaid's names
  return cleanAprs(raw.map((a: any) => ({ apr_type: a?.type, apr_percentage: a?.pct, balance_subject_to_apr: a?.balance, interest_charge_amount: a?.interest })));
}

export type Summary = Awaited<ReturnType<typeof getSummary>>;
