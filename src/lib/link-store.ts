import { db } from './db';
import { linkSubscriptions, parseLinkEmail, type LinkEvent } from './link';
import type { IncomingReceipt } from './apple-store';

/** Store Link emails from one person's Gmail. Already-seen emails are skipped, so the script can safely resend. */
export async function ingestLinkEmails(email: string, emails: IncomingReceipt[]) {
  const sql = await db();
  const now = new Date().toISOString();
  let fresh = 0;
  let items = 0;
  for (const e of emails) {
    if ((await sql.query('SELECT 1 FROM link_emails WHERE message_id = $1', [e.id])).rows.length) continue;
    const events = parseLinkEmail(e.subject ?? '', e.text, e.date);
    for (const [i, ev] of events.entries()) {
      items++;
      await sql.query(
        `INSERT INTO link_events (id, owner_email, message_id, kind, name, amount, date, renewed, months, cadence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
        [`${e.id}:${i}`, email, e.id, ev.kind, ev.name, ev.amount, ev.date, ev.kind === 'charge' && ev.renewed, ev.kind === 'upcoming' ? ev.months : null, ev.kind === 'upcoming' ? ev.cadence : null],
      );
    }
    await sql.query('INSERT INTO link_emails (message_id, owner_email, received, ingested_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [e.id, email, e.date.slice(0, 10), now]);
    fresh++;
  }
  return { received: emails.length, new: fresh, items };
}

/** Each person's Link subscriptions that still look active. */
export async function linkSubscriptionsFor(today: string) {
  const sql = await db();
  const rows = (await sql.query('SELECT owner_email, kind, name, amount, date, renewed, months, cadence FROM link_events ORDER BY date')).rows;
  const byOwner = new Map<string, LinkEvent[]>();
  for (const r of rows) {
    const ev: LinkEvent = r.kind === 'upcoming'
      ? { kind: 'upcoming', name: r.name, amount: Number(r.amount), date: r.date, months: r.months == null ? null : Number(r.months), cadence: r.cadence ?? null }
      : { kind: 'charge', name: r.name, amount: Number(r.amount), date: r.date, renewed: r.renewed === true };
    (byOwner.get(r.owner_email) ?? byOwner.set(r.owner_email, []).get(r.owner_email)!).push(ev);
  }
  return [...byOwner].flatMap(([owner, events]) => linkSubscriptions(events, today).map((s) => ({ ...s, owner })));
}

export async function linkStatus(email: string) {
  const sql = await db();
  const r = (await sql.query('SELECT count(*)::int AS n, max(ingested_at) AS last FROM link_emails WHERE owner_email = $1', [email])).rows[0];
  return { emails: Number(r?.n ?? 0), lastSent: (r?.last ?? null) as string | null };
}
