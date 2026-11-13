import type { APIRoute } from 'astro';
import { json, readJson, str } from '@/lib/http';
import { assignTxn } from '@/lib/budget';

export const POST: APIRoute = async ({ request }) => {
  const body = await readJson(request);
  const txnId = str(body?.txnId);
  if (!body || !txnId) return json({ error: 'Missing txnId' }, 400);
  const lineId = body.lineId === null ? null : str(body.lineId);
  if (lineId === undefined) return json({ error: 'Missing lineId' }, 400);
  try {
    const ok = await assignTxn(txnId, lineId, body.remember !== false);
    return ok ? json({ ok: true }) : json({ error: 'That transaction or line no longer exists' }, 404);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not save' }, 500);
  }
};
