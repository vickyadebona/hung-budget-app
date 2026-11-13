import type { APIRoute } from 'astro';
import { json, readJson, str } from '@/lib/http';
import { PlaidError, exchangePublicToken, syncAll } from '@/lib/plaid';

export const POST: APIRoute = async ({ request, locals }) => {
  const body = (await readJson(request)) ?? {};
  const publicToken = str(body.publicToken);
  if (!publicToken) return json({ error: 'Missing publicToken' }, 400);
  try {
    const itemId = await exchangePublicToken(locals.user.email, publicToken, str(body.institutionName));
    const results = await syncAll();
    return json({ itemId, results });
  } catch (e) {
    if (!(e instanceof PlaidError)) console.error('[exchange]', e instanceof Error ? e.stack ?? e.message : e);
    if (e instanceof PlaidError) return json({ error: e.message, code: e.code }, 502);
    return json({ error: e instanceof Error ? e.message : 'Could not finish linking' }, 500);
  }
};
