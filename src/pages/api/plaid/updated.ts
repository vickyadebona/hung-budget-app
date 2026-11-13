import type { APIRoute } from 'astro';
import { json, readJson, str } from '@/lib/http';
import { liabilitiesAllowed, syncAll } from '@/lib/plaid';

// After reopening an existing bank login (repair or new permission). Nothing to exchange: the saved login stays the same.
export const POST: APIRoute = async ({ request }) => {
  const body = (await readJson(request)) ?? {};
  const itemId = str(body.itemId);
  if (!itemId) return json({ error: 'Missing itemId' }, 400);
  try {
    if (body.consent === 'liabilities') await liabilitiesAllowed(itemId);
    return json({ results: await syncAll() });
  } catch (e) {
    console.error('[updated]', e instanceof Error ? e.stack ?? e.message : e);
    return json({ error: e instanceof Error ? e.message : 'Could not refresh' }, 500);
  }
};
