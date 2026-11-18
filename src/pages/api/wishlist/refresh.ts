import type { APIRoute } from 'astro';
import { json, readJson, str } from '@/lib/http';
import { refreshPrices } from '@/lib/wishlist';

// Re-reads prices now: one item with { itemId }, or everything with {}.
export const POST: APIRoute = async ({ request }) => {
  const body = (await readJson(request)) ?? {};
  try {
    return json(await refreshPrices(str(body.itemId)));
  } catch (e) {
    console.error('[wishlist]', e instanceof Error ? e.stack ?? e.message : e);
    return json({ error: 'Could not refresh prices' }, 500);
  }
};
