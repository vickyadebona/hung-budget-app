import type { APIRoute } from 'astro';
import { json, readJson, str } from '@/lib/http';
import { itemToGoal } from '@/lib/wishlist';

// { itemId, accountId? } makes a savings goal for a wishlist item.
export const POST: APIRoute = async ({ request }) => {
  const body = await readJson(request);
  const itemId = str(body?.itemId);
  if (!itemId) return json({ error: 'Missing item' }, 400);
  try {
    const err = await itemToGoal(itemId, str(body?.accountId));
    return err ? json({ error: err }, 400) : json({ ok: true });
  } catch (e) {
    console.error('[wishlist]', e instanceof Error ? e.stack ?? e.message : e);
    return json({ error: 'Could not make the goal' }, 500);
  }
};
