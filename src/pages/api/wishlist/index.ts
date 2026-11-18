import type { APIRoute } from 'astro';
import { json } from '@/lib/http';
import { getWishlist } from '@/lib/wishlist';

export const GET: APIRoute = async () => {
  try {
    return json(await getWishlist());
  } catch (e) {
    console.error('[wishlist]', e instanceof Error ? e.stack ?? e.message : e);
    return json({ error: 'Could not load the wishlist' }, 500);
  }
};
