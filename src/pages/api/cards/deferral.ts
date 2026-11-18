import crypto from 'node:crypto';
import type { APIRoute } from 'astro';
import { json, readJson, str } from '@/lib/http';
import { db } from '@/lib/db';
import { DEFERRAL_KINDS, type DeferralKind } from '@/lib/cards';

/**
 * Add, change or remove one 0%/deferred part of a card balance.
 *   { accountId, kind, label?, amount?, ends }      add (or change, with id)
 *   { id, delete: true }                             remove
 * amount may be left out to mean "whatever the bank reports at 0%" (or the whole balance).
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const body = await readJson(request);
  if (!body) return json({ error: 'Nothing sent' }, 400);
  try {
    const sql = await db();
    const id = str(body.id);
    if (body.delete === true) {
      if (!id) return json({ error: 'Missing id' }, 400);
      await sql.query('DELETE FROM card_deferrals WHERE id = $1', [id]);
      return json({ ok: true });
    }

    const accountId = str(body.accountId);
    if (!accountId) return json({ error: 'Missing accountId' }, 400);
    const kind = str(body.kind) as DeferralKind | undefined;
    if (!kind || !DEFERRAL_KINDS.includes(kind)) return json({ error: 'Pick what kind of offer this is' }, 400);
    const ends = str(body.ends);
    if (!ends || !/^\d{4}-\d{2}-\d{2}$/.test(ends) || Number.isNaN(Date.parse(ends))) return json({ error: 'Pick the date it ends' }, 400);
    let amount: number | null = null;
    if (body.amount !== null && body.amount !== undefined && body.amount !== '') {
      amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return json({ error: 'Enter the amount as a number above 0' }, 400);
      amount = Math.round(amount * 100) / 100;
    }
    const label = (str(body.label) ?? '').trim().slice(0, 60);

    const card = await sql.query(`SELECT 1 FROM accounts WHERE id = $1 AND type = 'credit'`, [accountId]);
    if (!card.rows.length) return json({ error: 'That card was not found' }, 404);
    await sql.query(
      `INSERT INTO card_deferrals (id, account_id, kind, label, amount, ends, set_by, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, label = EXCLUDED.label, amount = EXCLUDED.amount, ends = EXCLUDED.ends,
         set_by = EXCLUDED.set_by, updated_at = EXCLUDED.updated_at`,
      [id ?? crypto.randomUUID(), accountId, kind, label, amount, ends, locals.user.email, new Date().toISOString()],
    );
    return json({ ok: true });
  } catch (e) {
    console.error('[deferral]', e instanceof Error ? e.stack ?? e.message : e);
    return json({ error: 'Could not save' }, 500);
  }
};
