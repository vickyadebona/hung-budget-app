import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './auth';

/** The one thing the app needs from a Postgres driver. Neon (hosted) and PGlite (local file) both fit. */
export interface Sql {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS items (
    id               text PRIMARY KEY,
    owner_email      text NOT NULL,
    institution_id   text,
    institution_name text NOT NULL DEFAULT 'Bank',
    token_enc        text NOT NULL,
    cursor           text,
    plaid_env        text NOT NULL,
    status           text NOT NULL DEFAULT 'ok',
    created_at       text NOT NULL,
    last_synced_at   text
  )`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id            text PRIMARY KEY,
    item_id       text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    name          text NOT NULL,
    official_name text,
    mask          text,
    type          text NOT NULL,
    subtype       text,
    current       double precision,
    available     double precision,
    currency      text,
    updated_at    text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id              text PRIMARY KEY,
    item_id         text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    account_id      text NOT NULL,
    date            text NOT NULL,
    name            text NOT NULL,
    merchant_name   text,
    amount          double precision NOT NULL,
    category        text,
    category_detail text,
    pending         boolean NOT NULL DEFAULT false,
    channel         text
  )`,
  `CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions (date)`,
  `CREATE TABLE IF NOT EXISTS recurring (
    id             text PRIMARY KEY,
    item_id        text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    account_id     text NOT NULL,
    direction      text NOT NULL,
    description    text NOT NULL,
    merchant_name  text,
    frequency      text NOT NULL,
    avg_amount     double precision,
    last_amount    double precision,
    last_date      text,
    next_date      text,
    status         text,
    is_active      boolean NOT NULL DEFAULT true,
    category       text
  )`,
  `CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS budget_lines (
    id        text PRIMARY KEY,
    name      text NOT NULL,
    grp       text NOT NULL,
    direction text NOT NULL DEFAULT 'out',
    amount    double precision NOT NULL DEFAULT 0,
    frequency text NOT NULL DEFAULT 'monthly',
    kind      text NOT NULL DEFAULT 'variable',
    need      text NOT NULL DEFAULT '',
    note      text NOT NULL DEFAULT '',
    match     jsonb NOT NULL DEFAULT '[]',
    ord       double precision NOT NULL DEFAULT 0
  )`,
  // Your manual choice for one transaction. line_id NULL means "this is not spending".
  `CREATE TABLE IF NOT EXISTS txn_overrides (txn_id text PRIMARY KEY, line_id text)`,
  // Apple subscriptions read from each person's Gmail receipts.
  `CREATE TABLE IF NOT EXISTS apple_subscriptions (
    owner_email    text NOT NULL,
    key            text NOT NULL,
    name           text NOT NULL,
    price          double precision NOT NULL,
    previous_price double precision,
    months         double precision,
    renews         text,
    last_charged   text NOT NULL,
    first_seen     text NOT NULL,
    PRIMARY KEY (owner_email, key)
  )`,
  `CREATE TABLE IF NOT EXISTS apple_receipts (message_id text PRIMARY KEY, owner_email text NOT NULL, received text NOT NULL, ingested_at text NOT NULL)`,
  // Credit card statement details from Plaid Liabilities.
  `CREATE TABLE IF NOT EXISTS card_liabilities (
    account_id         text PRIMARY KEY,
    item_id            text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    next_due           text,
    minimum            double precision,
    statement_balance  double precision,
    statement_date     text,
    last_payment       double precision,
    last_payment_date  text,
    is_overdue         boolean,
    updated_at         text NOT NULL
  )`,
  // 'ok', 'consent' (needs the owner to allow it), 'unsupported', or null (not tried yet).
  `ALTER TABLE items ADD COLUMN IF NOT EXISTS liabilities text`,
  // Each card's interest rates from Plaid: [{ type, pct, balance, interest }].
  `ALTER TABLE card_liabilities ADD COLUMN IF NOT EXISTS aprs jsonb`,
  // What Link (Stripe's wallet) emails say: charges, renewals and payments coming up. One row per item in an email.
  `CREATE TABLE IF NOT EXISTS link_events (
    id          text PRIMARY KEY,
    owner_email text NOT NULL,
    message_id  text NOT NULL,
    kind        text NOT NULL,
    name        text NOT NULL,
    amount      double precision NOT NULL,
    date        text NOT NULL,
    renewed     boolean NOT NULL DEFAULT false,
    months      double precision,
    cadence     text
  )`,
  `CREATE TABLE IF NOT EXISTS link_emails (message_id text PRIMARY KEY, owner_email text NOT NULL, received text NOT NULL, ingested_at text NOT NULL)`,
  // A 0% offer's end date, typed in by you (Plaid does not provide it).
  `CREATE TABLE IF NOT EXISTS card_promos (
    account_id text PRIMARY KEY,
    ends       text NOT NULL,
    set_by     text NOT NULL,
    updated_at text NOT NULL
  )`,
  // Savings goals. A goal can point at a linked savings account; set-asides you log by hand go in goal_entries.
  `CREATE TABLE IF NOT EXISTS goals (
    id          text PRIMARY KEY,
    name        text NOT NULL,
    target      double precision NOT NULL,
    target_date text,
    account_id  text,
    created_at  text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS goal_entries (
    id       text PRIMARY KEY,
    goal_id  text NOT NULL,
    amount   double precision NOT NULL,
    note     text NOT NULL DEFAULT '',
    date     text NOT NULL,
    by_email text NOT NULL
  )`,
  // Wishlist: things you want to buy. Each item can have several store links, and each link's price is tracked.
  `CREATE TABLE IF NOT EXISTS wishlist_items (
    id           text PRIMARY KEY,
    name         text NOT NULL,
    note         text NOT NULL DEFAULT '',
    target_price double precision,
    created_by   text NOT NULL,
    created_at   text NOT NULL,
    bought_at    text
  )`,
  `CREATE TABLE IF NOT EXISTS wishlist_links (
    id         text PRIMARY KEY,
    item_id    text NOT NULL,
    url        text NOT NULL,
    store      text NOT NULL,
    price      double precision,
    price_prev double precision,
    status     text NOT NULL DEFAULT 'pending',
    message    text NOT NULL DEFAULT '',
    checked_at text,
    in_stock   boolean,
    created_at text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS wishlist_prices (
    link_id text NOT NULL,
    date    text NOT NULL,
    price   double precision NOT NULL,
    PRIMARY KEY (link_id, date)
  )`,
  // Your corrections to the recurring list: cancelled, yearly, monthly, active (not cancelled), not-subscription.
  `CREATE TABLE IF NOT EXISTS subscription_marks (
    key        text PRIMARY KEY,
    mark       text NOT NULL,
    label      text,
    set_by     text NOT NULL,
    updated_at text NOT NULL
  )`,
];

let ready: Promise<Sql> | null = null;

/* ---------- demo mode ----------
 * A demo sign-in runs every request inside demoScope. db() then hands back a separate in-memory database
 * filled with made-up data, so nothing a demo viewer sees or does can reach the real one.
 */
const demoScope = new AsyncLocalStorage<true>();
let demoReady: Promise<Sql> | null = null;

export const inDemo = (): boolean => demoScope.getStore() === true;
export const runAsDemo = <T>(fn: () => T): T => demoScope.run(true, fn);

async function connectDemo(): Promise<Sql> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite(); // memory only: never written to disk, gone when the server restarts
  const sql: Sql = { query: (text, params) => pg.query(text, (params ?? []) as any[]) as any };
  for (const stmt of SCHEMA) await sql.query(stmt);
  const { seedDemo } = await import('./demo');
  await seedDemo(sql);
  return sql;
}

async function connect(): Promise<Sql> {
  const url = env('DATABASE_URL');
  let sql: Sql;
  if (url) {
    const { neon } = await import('@neondatabase/serverless');
    const n = neon(url, { fullResults: true });
    sql = { query: (text, params) => n.query(text, (params ?? []) as any[]) as any };
  } else {
    // Local development: a real Postgres engine stored in ./data, nothing to install.
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = path.resolve(env('DATA_DIR') || './data/pg');
    fs.mkdirSync(dir, { recursive: true });
    const pg = new PGlite(dir);
    sql = { query: (text, params) => pg.query(text, (params ?? []) as any[]) as any };
  }
  for (const stmt of SCHEMA) await sql.query(stmt);
  return sql;
}

export function db(): Promise<Sql> {
  if (inDemo()) {
    if (!demoReady) demoReady = connectDemo().catch((e) => { demoReady = null; throw e; });
    return demoReady;
  }
  if (!ready) ready = connect().catch((e) => { ready = null; throw e; });
  return ready;
}

export async function getMeta(sql: Sql, key: string): Promise<string | null> {
  const r = await sql.query('SELECT value FROM meta WHERE key = $1', [key]);
  return r.rows[0]?.value ?? null;
}

export async function setMeta(sql: Sql, key: string, value: string): Promise<void> {
  await sql.query(
    'INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, value],
  );
}
