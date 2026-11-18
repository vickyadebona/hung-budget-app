import type { APIRoute } from 'astro';
import { json, readJson, str } from '@/lib/http';
import { deleteGoal, saveGoal } from '@/lib/goals';

// Create or change a goal; { id, delete: true } removes it.
export const POST: APIRoute = async ({ request }) => {
  const body = await readJson(request);
  if (!body) return json({ error: 'Bad request' }, 400);
  try {
    if (body.delete === true) {
      const id = str(body.id);
      if (!id) return json({ error: 'Missing id' }, 400);
      await deleteGoal(id);
      return json({ ok: true });
    }
    const err = await saveGoal({ ...body, id: str(body.id) });
    return err ? json({ error: err }, 400) : json({ ok: true });
  } catch (e) {
    console.error('[goals]', e instanceof Error ? e.stack ?? e.message : e);
    return json({ error: 'Could not save' }, 500);
  }
};
