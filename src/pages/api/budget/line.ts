import type { APIRoute } from 'astro';
import { json, readJson, str } from '@/lib/http';
import { deleteLine, saveLine } from '@/lib/budget';

// Create or change a budget line; send { id, delete: true } to remove one.
export const POST: APIRoute = async ({ request }) => {
  const body = await readJson(request);
  if (!body) return json({ error: 'Bad request' }, 400);
  try {
    if (body.delete === true) {
      const id = str(body.id);
      if (!id) return json({ error: 'Missing id' }, 400);
      await deleteLine(id);
      return json({ ok: true });
    }
    const line = await saveLine(body);
    return line ? json({ line }) : json({ error: 'A line needs a name' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not save' }, 500);
  }
};
