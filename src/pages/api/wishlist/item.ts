import type { APIRoute } from 'astro';
import { json, readJson, str } from '@/lib/http';
import { deleteItem, saveItem, setBought } from '@/lib/wishlist';

// Create or change an item. { id, delete: true } removes it; { id, bought: true|false } marks it bought or not.
export const POST: APIRoute = async ({ request, locals }) => {
  const body = await readJson(request);
  if (!body) return json({ error: 'Bad request' }, 400);
  try {
    const id = str(body.id);
    if (body.delete === true) {
      if (!id) return json({ error: 'Missing id' }, 400);
      await deleteItem(id);
      return json({ ok: true });
    }
    if (typeof body.bought === 'boolean') {
      if (!id) return json({ error: 'Missing id' }, 400);
      await setBought(id, body.bought);
      return json({ ok: true });
    }
    const r = await saveItem({ ...body, id }, locals.user.email);
    return typeof r === 'string' ? json({ error: r }, 400) : json({ ok: true, id: r.id });
  } catch (e) {
    console.error('[wishlist]', e instanceof Error ? e.stack ?? e.message : e);
    return json({ error: 'Could not save' }, 500);
  }
};
