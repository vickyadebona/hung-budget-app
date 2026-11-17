import type { APIRoute } from 'astro';
import { json, readJson, str } from '@/lib/http';
import { db } from '@/lib/db';

// { accountId, ends: 'YYYY-MM-DD' } sets when a card's 0% offer ends; { accountId, ends: null } clears it.
export const POST: APIRoute = async ({ request, locals }) => {
  const body = await readJson(request);
  const accountId = str(body?.accountId);
  if (!body || !accountId) return json({ error: 'Missing accountId' }, 400);
  const ends = body.ends === null ? null : str(body.ends);
  if (ends !== null && (!ends || !/^\d{4}-\d{2}-\d{2}$/.test(ends) || Number.isNaN(Date.parse(ends)))) {
    return json({ error: 'Pick a date for when the 0% offer ends' }, 400);
  }
  try {
    const sql = await db();
    const card = await sql.query(`SELECT 1 FROM accounts WHERE id = $1 AND type = 'credit'`, [accountId]);
    if (!card.rows.length) return json({ error: 'That card was not found' }, 404);
    if (ends === null) await sql.query('DELETE FROM card_promos WHERE account_id = $1', [accountId]);
    else {
      await sql.query(
        `INSERT INTO card_promos (account_id, ends, set_by, updated_at) VALUES ($1,$2,$3,$4)
         ON CONFLICT (account_id) DO UPDATE SET ends = EXCLUDED.ends, set_by = EXCLUDED.set_by, updated_at = EXCLUDED.updated_at`,
        [accountId, ends, locals.user.email, new Date().toISOString()],
      );
    }
    return json({ ok: true });
  } catch (e) {
    console.error('[promo]', e instanceof Error ? e.stack ?? e.message : e);
    return json({ error: 'Could not save' }, 500);
  }
};
