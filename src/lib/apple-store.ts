import crypto from 'node:crypto';
import { allowedEmails, env } from './auth';
import { db } from './db';
import { monthlyApple, parseAppleReceipt } from './apple';

/**
 * Each person gets their own key for the Gmail script. It is derived from the app's SESSION_SECRET,
 * so nothing extra is stored, and changing SESSION_SECRET cancels every key.
 */
export function appleKeyFor(email: string): string {
  const secret = env('SESSION_SECRET');
  if (!secret || secret === 'change-me') throw new Error('SESSION_SECRET is not set');
  return crypto.createHmac('sha256', secret).update('apple-ingest:' + email.toLowerCase()).digest('base64url').slice(0, 32);
}

/** Which signed-in person a script key belongs to, or null. */
export function emailForKey(key: string): string | null {
  if (!key || key.length !== 32) return null;
  for (const email of allowedEmails()) {
    const want = Buffer.from(appleKeyFor(email));
    const got = Buffer.from(key);
    if (got.length === want.length && crypto.timingSafeEqual(got, want)) return email;
  }
  return null;
}

export interface IncomingReceipt { id: string; date: string; subject?: string; text: string }

/** Store receipts from one person's Gmail. Already-seen emails are skipped, so the script can safely resend. */
export async function ingestReceipts(email: string, receipts: IncomingReceipt[]) {
  const sql = await db();
  const now = new Date().toISOString();
  let fresh = 0;
  let items = 0;
  const ordered = [...receipts].sort((a, b) => a.date.localeCompare(b.date)); // oldest first, so the newest price wins
  for (const r of ordered) {
    const seen = await sql.query('SELECT 1 FROM apple_receipts WHERE message_id = $1', [r.id]);
    if (seen.rows.length) continue;
    const chargedOn = r.date.slice(0, 10);
    for (const it of parseAppleReceipt(r.text, chargedOn)) {
      items++;
      await sql.query(
        `INSERT INTO apple_subscriptions (owner_email, key, name, price, months, renews, last_charged, first_seen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (owner_email, key) DO UPDATE SET
           previous_price = CASE WHEN EXCLUDED.last_charged >= apple_subscriptions.last_charged AND EXCLUDED.price <> apple_subscriptions.price
                                 THEN apple_subscriptions.price ELSE apple_subscriptions.previous_price END,
           name     = CASE WHEN EXCLUDED.last_charged >= apple_subscriptions.last_charged THEN EXCLUDED.name ELSE apple_subscriptions.name END,
           price    = CASE WHEN EXCLUDED.last_charged >= apple_subscriptions.last_charged THEN EXCLUDED.price ELSE apple_subscriptions.price END,
           months   = COALESCE(CASE WHEN EXCLUDED.last_charged >= apple_subscriptions.last_charged THEN EXCLUDED.months END, apple_subscriptions.months),
           renews   = CASE WHEN EXCLUDED.last_charged >= apple_subscriptions.last_charged THEN EXCLUDED.renews ELSE apple_subscriptions.renews END,
           last_charged = GREATEST(EXCLUDED.last_charged, apple_subscriptions.last_charged)`,
        [email, it.key, it.name, it.price, it.months, it.renews, chargedOn, chargedOn],
      );
    }
    await sql.query('INSERT INTO apple_receipts (message_id, owner_email, received, ingested_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [r.id, email, chargedOn, now]);
    fresh++;
  }
  return { received: receipts.length, new: fresh, items };
}

const DAY = 86400000;

/** Subscriptions still running: renewing in the future, or renewed so recently that the next receipt may not be in yet. */
export async function appleSubscriptions(today = new Date().toISOString().slice(0, 10)) {
  const sql = await db();
  const rows = (await sql.query('SELECT * FROM apple_subscriptions ORDER BY name')).rows;
  const graceFrom = new Date(Date.parse(today) - 7 * DAY).toISOString().slice(0, 10);
  return rows
    .filter((r) => r.renews && r.renews >= graceFrom)
    .map((r) => {
      const price = Number(r.price);
      const months = r.months == null ? null : Number(r.months);
      return {
        id: `apple:${r.owner_email}:${r.key}`,
        owner: r.owner_email as string,
        name: r.name as string,
        price,
        months,
        monthly: monthlyApple(price, months),
        renews: r.renews as string,
        lastCharged: r.last_charged as string,
        previousPrice: r.previous_price == null ? null : Number(r.previous_price),
        trial: price === 0,
      };
    });
}

/** For Settings: how many receipts each person has sent and when the last one arrived. */
export async function appleStatus(email: string) {
  const sql = await db();
  const r = (await sql.query('SELECT count(*)::int AS n, max(ingested_at) AS last FROM apple_receipts WHERE owner_email = $1', [email])).rows[0];
  return { receipts: Number(r?.n ?? 0), lastSent: (r?.last ?? null) as string | null };
}
