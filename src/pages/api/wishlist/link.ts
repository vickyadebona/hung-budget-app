import type { APIRoute } from 'astro';
import { json, readJson, str } from '@/lib/http';
import { addLink, deleteLink, setLinkPrice } from '@/lib/wishlist';

// { itemId, url } adds a store link and reads its price; { linkId, price } sets a price by hand; { linkId, delete: true } removes one.
export const POST: APIRoute = async ({ request }) => {
  const body = await readJson(request);
  if (!body) return json({ error: 'Bad request' }, 400);
  try {
    const linkId = str(body.linkId);
    if (body.delete === true) {
      if (!linkId) return json({ error: 'Missing id' }, 400);
      await deleteLink(linkId);
      return json({ ok: true });
    }
    if (linkId && body.price !== undefined) {
      const price = typeof body.price === 'number' ? body.price : Number(String(body.price).replace(/[$,\s]/g, ''));
      const err = await setLinkPrice(linkId, price);
      return err ? json({ error: err }, 400) : json({ ok: true });
    }
    const itemId = str(body.itemId), url = str(body.url);
    if (!itemId || !url) return json({ error: 'Paste a link' }, 400);
    const r = await addLink(itemId, url);
    return typeof r === 'string' ? json({ error: r }, 400) : json({ ok: true, title: r.title });
  } catch (e) {
    console.error('[wishlist]', e instanceof Error ? e.stack ?? e.message : e);
    return json({ error: 'Could not save' }, 500);
  }
};
