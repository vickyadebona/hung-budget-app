import type { APIRoute } from 'astro';
import { json, readJson, str } from '@/lib/http';
import { addEntry, deleteEntry } from '@/lib/goals';

// { goalId, amount, note } logs money set aside (negative = taken back out); { entryId, delete: true } undoes one.
export const POST: APIRoute = async ({ request, locals }) => {
  const body = await readJson(request);
  if (!body) return json({ error: 'Bad request' }, 400);
  try {
    if (body.delete === true) {
      const entryId = str(body.entryId);
      if (!entryId) return json({ error: 'Missing id' }, 400);
      await deleteEntry(entryId);
      return json({ ok: true });
    }
    const goalId = str(body.goalId);
    const amount = typeof body.amount === 'number' ? body.amount : Number(String(body.amount ?? '').replace(/[$,\s]/g, ''));
    if (!goalId) return json({ error: 'Missing goal' }, 400);
    const err = await addEntry(goalId, amount, str(body.note) ?? '', locals.user.email);
    return err ? json({ error: err }, 400) : json({ ok: true });
  } catch (e) {
    console.error('[goals]', e instanceof Error ? e.stack ?? e.message : e);
    return json({ error: 'Could not save' }, 500);
  }
};
