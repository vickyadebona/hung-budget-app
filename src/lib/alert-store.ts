import { db, firstName, getMeta, setMeta, type Sql } from './db';
import { plaidEnv } from './plaid';
import { sharedAccounts } from './dedupe';
import { merchantKey } from './recurring';
import { getSummary, type Summary } from './summary';
import { addDays } from './calendar';
import { buildAlerts, DEFAULT_SETTINGS, digestEmail, type Alert, type AlertSettings } from './alerts';

// Not purchases: moving money between your own accounts and paying off cards.
const NOT_SPENDING = /^(TRANSFER_IN|TRANSFER_OUT|LOAN_PAYMENTS|INCOME|BANK_FEES_OVERDRAFT)/;
const NEW_FOR_DAYS = 14; // a repeating charge counts as "new" for two weeks after it first appears

export async function alertSettings(sql: Sql): Promise<AlertSettings> {
  try {
    const raw = JSON.parse((await getMeta(sql, 'alert_settings')) ?? '{}');
    const pick = (k: keyof AlertSettings, min: number, max: number) => {
      const v = Number(raw?.[k]);
      return Number.isFinite(v) && v >= min && v <= max ? v : DEFAULT_SETTINGS[k];
    };
    return { largeCharge: pick('largeCharge', 1, 1_000_000), billDays: pick('billDays', 0, 14), deferralDays: pick('deferralDays', 1, 120) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveAlertSettings(sql: Sql, s: Partial<AlertSettings>): Promise<AlertSettings> {
  const merged = { ...(await alertSettings(sql)), ...s };
  await setMeta(sql, 'alert_settings', JSON.stringify(merged));
  return alertSettings(sql);
}

/** Whether this person wants the daily email. On unless they turned it off. */
export async function emailOn(sql: Sql, email: string): Promise<boolean> {
  return (await getMeta(sql, 'alert_email:' + email.toLowerCase())) !== 'off';
}
export async function setEmailOn(sql: Sql, email: string, on: boolean): Promise<void> {
  await setMeta(sql, 'alert_email:' + email.toLowerCase(), on ? 'on' : 'off');
}

/** Remembers each repeating charge the first time it is seen and returns the ones seen in the last two weeks. */
async function newRecurringIds(sql: Sql, ids: string[], today: string): Promise<string[]> {
  const known = new Map<string, string>((await sql.query('SELECT id, first_seen FROM known_recurring')).rows.map((r) => [r.id, r.first_seen]));
  // The very first time, everything already there is the starting point, not news.
  const firstRun = known.size === 0;
  for (const id of ids) {
    if (known.has(id)) continue;
    const seen = firstRun ? '2000-01-01' : today;
    await sql.query('INSERT INTO known_recurring (id, first_seen) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [id, seen]);
    known.set(id, seen);
  }
  const since = addDays(today, -NEW_FOR_DAYS);
  return ids.filter((id) => (known.get(id) ?? '') >= since);
}

/** Purchases from the last week, with who made them. Card payments, transfers and known repeating bills are left out. */
async function recentCharges(sql: Sql, summary: Summary, today: string) {
  const env = plaidEnv();
  const { dup, shared } = await sharedAccounts(sql, env);
  const names = new Map<string, string>((await sql.query('SELECT email, name FROM people')).rows.map((p) => [p.email as string, p.name as string]));
  const rows = (await sql.query(
    `SELECT t.id, t.date, t.name, t.merchant_name, t.amount, t.category, t.account_id, t.account_owner, i.owner_email AS owner
     FROM transactions t JOIN items i ON i.id = t.item_id
     WHERE i.plaid_env = $1 AND t.date >= $2 AND NOT t.pending AND t.amount > 0 AND NOT (t.account_id = ANY($3))`,
    [env, addDays(today, -7), [...dup.keys()]],
  )).rows;
  const bills = new Set(summary.recurring.map((r) => merchantKey({ name: r.label })));
  return rows
    .filter((r) => !NOT_SPENDING.test(r.category ?? ''))
    .filter((r) => !bills.has(merchantKey({ name: r.name, merchant: r.merchant_name })))
    .map((r) => ({
      id: r.id as string,
      date: r.date as string,
      name: (r.merchant_name || r.name) as string,
      amount: Number(r.amount),
      who: r.account_owner ? String(r.account_owner) : shared.has(r.account_id) ? null : firstName(r.owner, names.get(r.owner)),
    }));
}

/** Every current alert, with a flag for the ones either of you dismissed. */
export async function getAlerts(summary?: Summary) {
  const sql = await db();
  const s = summary ?? (await getSummary());
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
  const settings = await alertSettings(sql);
  // Repeating "charges" that are really paying off a card: the card's due date already covers them.
  const payments = new Set((await sql.query(
    `SELECT DISTINCT name, merchant_name FROM transactions WHERE category_detail = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' AND date >= $1`, [addDays(today, -120)],
  )).rows.map((r) => merchantKey({ name: r.name, merchant: r.merchant_name })));
  const alerts = buildAlerts({
    today,
    cards: s.cards.map((c) => ({ id: c.id, name: c.name, mask: c.mask, state: c.state, details: c.details, deferrals: { plans: c.deferrals.plans } })),
    recurring: s.recurring.map((r) => ({
      id: r.id, label: r.label, amount: r.amount, nextDate: r.nextDate, priceChanged: r.priceChanged,
      previousAmount: (r as { previousAmount?: number | null }).previousAmount ?? null, source: r.source,
      cardPayment: payments.has(merchantKey({ name: r.label })),
    })),
    charges: await recentCharges(sql, s, today),
    newRecurring: await newRecurringIds(sql, s.recurring.map((r) => r.id), today),
  }, settings);
  const dismissed = new Set((await sql.query('SELECT id FROM alert_dismissed')).rows.map((r) => r.id as string));
  return { today, settings, alerts: alerts.map((a) => ({ ...a, dismissed: dismissed.has(a.id) })) };
}

export async function dismissAlert(id: string, email: string, undo = false): Promise<void> {
  const sql = await db();
  if (undo) await sql.query('DELETE FROM alert_dismissed WHERE id = $1', [id]);
  else await sql.query('INSERT INTO alert_dismissed (id, by_email, at) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING', [id, email, new Date().toISOString()]);
}

/**
 * The daily email for one person: alerts they have not been emailed about and nobody dismissed.
 * Marks them as sent, so each one is emailed once. Returns null when there is nothing new (no email that day).
 */
export async function digestFor(email: string, appUrl: string): Promise<{ subject: string; text: string; count: number } | null> {
  const sql = await db();
  if (!(await emailOn(sql, email))) return null;
  const { alerts } = await getAlerts();
  const sent = new Set((await sql.query('SELECT id FROM alert_sent WHERE owner_email = $1', [email])).rows.map((r) => r.id as string));
  const fresh: Alert[] = alerts.filter((a) => !a.dismissed && !sent.has(a.id));
  const mail = digestEmail(fresh, appUrl);
  if (!mail) return null;
  const now = new Date().toISOString();
  for (const a of fresh) {
    await sql.query('INSERT INTO alert_sent (owner_email, id, sent_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [email, a.id, now]);
  }
  await sql.query('DELETE FROM alert_sent WHERE sent_at < $1', [new Date(Date.now() - 180 * 86400000).toISOString()]);
  return { ...mail, count: fresh.length };
}

export async function lastDigest(email: string): Promise<string | null> {
  const sql = await db();
  return (await sql.query('SELECT max(sent_at) AS at FROM alert_sent WHERE owner_email = $1', [email])).rows[0]?.at ?? null;
}
