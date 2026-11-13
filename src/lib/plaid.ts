import crypto from 'node:crypto';
import { env } from './auth';
import { db, getMeta, setMeta, type Sql } from './db';
import { decrypt, encrypt, keyFromHex } from './secrets';

/** Talks to Plaid's REST API directly (plain JSON over HTTPS), so there is no SDK to keep up to date. */

export type PlaidEnv = 'sandbox' | 'production';

export class PlaidError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function plaidEnv(): PlaidEnv {
  return env('PLAID_ENV') === 'production' ? 'production' : 'sandbox';
}

export function plaidConfigured(): boolean {
  return Boolean(env('PLAID_CLIENT_ID') && env('PLAID_SECRET'));
}

export function itemCap(): number {
  const n = Number.parseInt(env('PLAID_ITEM_CAP') || '10', 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

async function plaid<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!plaidConfigured()) throw new PlaidError('Plaid keys are not set. Add PLAID_CLIENT_ID and PLAID_SECRET to .env.', 'NOT_CONFIGURED', 500);
  const res = await fetch(`https://${plaidEnv()}.plaid.com${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: env('PLAID_CLIENT_ID'), secret: env('PLAID_SECRET'), ...body }),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    // Never include the request body here: it holds the secret.
    throw new PlaidError(data.error_message || `Plaid request failed (${res.status})`, data.error_code || 'UNKNOWN', res.status);
  }
  return data as T;
}

function tokenKey(): Buffer {
  const hex = env('TOKEN_KEY');
  if (hex) return keyFromHex(hex);
  if (plaidEnv() === 'sandbox') return crypto.createHash('sha256').update('sandbox-only-key').digest(); // fake banks only
  throw new Error('TOKEN_KEY is not set. It is required before linking real banks (run: openssl rand -hex 32).');
}

/* ---------- slots: the Trial plan allows a fixed number of real logins, ever (PLAID_ITEM_CAP) ---------- */

const SLOTS_KEY = 'production_slots_used';

export async function slotsUsed(sql: Sql): Promise<number> {
  return Number.parseInt((await getMeta(sql, SLOTS_KEY)) ?? '0', 10) || 0;
}

/* ---------- linking ---------- */

/** Stable, non-identifying id for Plaid (they ask us not to send emails here). */
const clientUserId = (email: string) => crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 32);

/** A link token opens Plaid's bank picker. With itemId it repairs an existing login instead (uses no slot). */
export async function createLinkToken(email: string, itemId?: string): Promise<string> {
  const sql = await db();
  const base: Record<string, unknown> = {
    user: { client_user_id: clientUserId(email) },
    client_name: 'Budget',
    language: 'en',
    country_codes: ['US'],
  };
  const redirect = env('PLAID_REDIRECT_URI');
  if (redirect) base.redirect_uri = redirect;

  if (itemId) {
    const r = await sql.query('SELECT token_enc FROM items WHERE id = $1', [itemId]);
    if (!r.rows[0]) throw new PlaidError('That bank login was not found.', 'NOT_FOUND', 404);
    base.access_token = decrypt(r.rows[0].token_enc, tokenKey());
  } else {
    if (plaidEnv() === 'production') {
      tokenKey(); // fail before the bank login, not after
      if ((await slotsUsed(sql)) >= itemCap()) {
        throw new PlaidError(`All ${itemCap()} bank logins on the free plan are used.`, 'SLOT_CAP', 409);
      }
    }
    base.products = ['transactions'];
    base.transactions = { days_requested: 730 }; // two years, so yearly renewals show up
  }
  const { link_token } = await plaid<{ link_token: string }>('/link/token/create', base);
  return link_token;
}

/** Finish linking: trade the one-time public token for a long-lived access token and store it encrypted. */
export async function exchangePublicToken(email: string, publicToken: string, hintName?: string): Promise<string> {
  const sql = await db();
  const { access_token, item_id } = await plaid<{ access_token: string; item_id: string }>('/item/public_token/exchange', {
    public_token: publicToken,
  });

  // Store first, look up the bank name second: the login already counts against the cap, so never lose the token.
  const isNew = (await sql.query('SELECT 1 FROM items WHERE id = $1', [item_id])).rows.length === 0;
  await sql.query(
    `INSERT INTO items (id, owner_email, institution_name, token_enc, plaid_env, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET token_enc = EXCLUDED.token_enc, status = 'ok'`,
    [item_id, email.toLowerCase(), hintName || 'Bank', encrypt(access_token, tokenKey()), plaidEnv(), new Date().toISOString()],
  );
  if (isNew && plaidEnv() === 'production') await setMeta(sql, SLOTS_KEY, String((await slotsUsed(sql)) + 1));

  try {
    const { item } = await plaid<{ item: { institution_id?: string; institution_name?: string } }>('/item/get', { access_token });
    let name = item.institution_name;
    if (!name && item.institution_id) {
      const r = await plaid<{ institution: { name: string } }>('/institutions/get_by_id', {
        institution_id: item.institution_id,
        country_codes: ['US'],
      });
      name = r.institution.name;
    }
    await sql.query('UPDATE items SET institution_id = $2, institution_name = COALESCE($3, institution_name) WHERE id = $1', [
      item_id,
      item.institution_id ?? null,
      name ?? null,
    ]);
  } catch {
    /* the name is cosmetic */
  }
  return item_id;
}

/** Sandbox only: link Plaid's fake bank without opening the picker. Handy for a first test. */
export async function sandboxConnect(email: string): Promise<string> {
  if (plaidEnv() !== 'sandbox') throw new PlaidError('Only available in sandbox.', 'NOT_SANDBOX', 400);
  const { public_token } = await plaid<{ public_token: string }>('/sandbox/public_token/create', {
    institution_id: 'ins_109508',
    initial_products: ['transactions'],
    options: { transactions: { days_requested: 730 } },
  });
  return exchangePublicToken(email, public_token, 'Sandbox bank');
}

/* ---------- syncing ---------- */

export interface SyncResult {
  item: string;
  name: string;
  added: number;
  ok: boolean;
  error?: string;
}

async function syncTransactions(sql: Sql, itemId: string, token: string, startCursor: string | null): Promise<{ cursor: string | null; added: number }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let cursor = startCursor;
    const added: any[] = [];
    const removed: string[] = [];
    try {
      for (let page = 0; page < 200; page++) {
        const r = await plaid<any>('/transactions/sync', { access_token: token, cursor: cursor ?? undefined, count: 500 });
        added.push(...r.added, ...r.modified);
        removed.push(...r.removed.map((x: any) => x.transaction_id));
        cursor = r.next_cursor;
        if (!r.has_more) break;
      }
    } catch (e) {
      // Plaid asks us to restart from the original cursor when data changes mid-read.
      if (e instanceof PlaidError && e.code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION') continue;
      throw e;
    }
    for (const t of added) {
      await sql.query(
        `INSERT INTO transactions (id, item_id, account_id, date, name, merchant_name, amount, category, category_detail, pending, channel)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO UPDATE SET date = EXCLUDED.date, name = EXCLUDED.name, merchant_name = EXCLUDED.merchant_name,
           amount = EXCLUDED.amount, category = EXCLUDED.category, category_detail = EXCLUDED.category_detail,
           pending = EXCLUDED.pending, channel = EXCLUDED.channel`,
        [
          t.transaction_id, itemId, t.account_id, t.date, t.name ?? '', t.merchant_name ?? null, t.amount,
          t.personal_finance_category?.primary ?? null, t.personal_finance_category?.detailed ?? null,
          t.pending === true, t.payment_channel ?? null,
        ],
      );
    }
    for (const id of removed) await sql.query('DELETE FROM transactions WHERE id = $1', [id]);
    return { cursor, added: added.length };
  }
  throw new PlaidError('Bank data kept changing while reading it. Try again in a minute.', 'SYNC_RETRY', 503);
}

async function syncAccounts(sql: Sql, itemId: string, token: string): Promise<void> {
  const { accounts } = await plaid<{ accounts: any[] }>('/accounts/get', { access_token: token });
  const now = new Date().toISOString();
  for (const a of accounts) {
    await sql.query(
      `INSERT INTO accounts (id, item_id, name, official_name, mask, type, subtype, current, available, currency, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, official_name = EXCLUDED.official_name, mask = EXCLUDED.mask,
         type = EXCLUDED.type, subtype = EXCLUDED.subtype, current = EXCLUDED.current, available = EXCLUDED.available,
         currency = EXCLUDED.currency, updated_at = EXCLUDED.updated_at`,
      [
        a.account_id, itemId, a.name ?? 'Account', a.official_name ?? null, a.mask ?? null, a.type ?? 'other', a.subtype ?? null,
        a.balances?.current ?? null, a.balances?.available ?? null, a.balances?.iso_currency_code ?? null, now,
      ],
    );
  }
}

async function syncRecurring(sql: Sql, itemId: string, token: string): Promise<void> {
  let r: any;
  try {
    r = await plaid<any>('/transactions/recurring/get', { access_token: token });
  } catch (e) {
    // Right after linking Plaid is still crunching history; the next sync picks it up.
    if (e instanceof PlaidError && e.code === 'PRODUCT_NOT_READY') return;
    throw e;
  }
  await sql.query('DELETE FROM recurring WHERE item_id = $1', [itemId]);
  const rows: [any, string][] = [
    ...(r.outflow_streams ?? []).map((s: any) => [s, 'out'] as [any, string]),
    ...(r.inflow_streams ?? []).map((s: any) => [s, 'in'] as [any, string]),
  ];
  for (const [s, direction] of rows) {
    await sql.query(
      `INSERT INTO recurring (id, item_id, account_id, direction, description, merchant_name, frequency, avg_amount, last_amount,
         last_date, next_date, status, is_active, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING`,
      [
        s.stream_id, itemId, s.account_id, direction, s.description ?? '', s.merchant_name ?? null, s.frequency ?? 'UNKNOWN',
        s.average_amount?.amount ?? null, s.last_amount?.amount ?? null, s.last_date ?? null, s.predicted_next_date ?? null,
        s.status ?? null, s.is_active !== false, s.personal_finance_category?.primary ?? null,
      ],
    );
  }
}

/** Pull the latest balances, transactions and recurring charges for every linked bank. One bank failing never blocks the rest. */
export async function syncAll(): Promise<SyncResult[]> {
  const sql = await db();
  const items = (await sql.query('SELECT id, institution_name, token_enc, cursor FROM items WHERE plaid_env = $1 ORDER BY created_at', [plaidEnv()])).rows;
  const results: SyncResult[] = [];
  for (const it of items) {
    try {
      const token = decrypt(it.token_enc, tokenKey());
      await syncAccounts(sql, it.id, token);
      const { cursor, added } = await syncTransactions(sql, it.id, token, it.cursor ?? null);
      await sql.query(`UPDATE items SET cursor = $2, status = 'ok', last_synced_at = $3 WHERE id = $1`, [it.id, cursor, new Date().toISOString()]);
      await syncRecurring(sql, it.id, token);
      results.push({ item: it.id, name: it.institution_name, added, ok: true });
    } catch (e) {
      const code = e instanceof PlaidError ? e.code : 'ERROR';
      // ITEM_LOGIN_REQUIRED means the bank wants the owner to sign in again ("Reconnect" in the app).
      await sql.query('UPDATE items SET status = $2 WHERE id = $1', [it.id, code === 'ITEM_LOGIN_REQUIRED' ? 'reconnect' : 'error']);
      results.push({ item: it.id, name: it.institution_name, added: 0, ok: false, error: e instanceof Error ? e.message : 'Sync failed' });
    }
  }
  return results;
}
