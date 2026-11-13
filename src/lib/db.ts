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
];

let ready: Promise<Sql> | null = null;

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
