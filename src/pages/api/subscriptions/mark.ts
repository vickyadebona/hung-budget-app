import type { APIRoute } from 'astro';
import { json, readJson, str } from '@/lib/http';
import { db } from '@/lib/db';
import { MARKS } from '@/lib/subscriptions';

// { key, mark } saves a correction to a recurring charge; { key, mark: null } removes it (undo).
export const POST: APIRoute = async ({ request, locals }) => {
  const body = await readJson(request);
  const key = str(body?.key);
  if (!body || !key || key.length > 200) return json({ error: 'Missing key' }, 400);
  const mark = body.mark === null ? null : str(body.mark);
  if (mark !== null && !(MARKS as string[]).includes(mark ?? '')) return json({ error: 'Unknown mark' }, 400);
  try {
    const sql = await db();
    if (mark === null) await sql.query('DELETE FROM subscription_marks WHERE key = $1', [key]);
    else {
      await sql.query(
        `INSERT INTO subscription_marks (key, mark, label, set_by, updated_at) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (key) DO UPDATE SET mark = EXCLUDED.mark, label = EXCLUDED.label, set_by = EXCLUDED.set_by, updated_at = EXCLUDED.updated_at`,
        [key, mark, str(body.label)?.slice(0, 100) ?? null, locals.user.email, new Date().toISOString()],
      );
    }
    return json({ ok: true });
  } catch (e) {
    console.error('[mark]', e instanceof Error ? e.stack ?? e.message : e);
    return json({ error: 'Could not save' }, 500);
  }
};
