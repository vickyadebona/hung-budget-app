import type { APIRoute } from 'astro';
import { json, readJson, str } from '@/lib/http';
import { PlaidError, createLinkToken } from '@/lib/plaid';

export const POST: APIRoute = async ({ request, locals }) => {
  const body = (await readJson(request)) ?? {};
  try {
    return json({ linkToken: await createLinkToken(locals.user.email, str(body.itemId)) });
  } catch (e) {
    if (!(e instanceof PlaidError)) console.error('[link-token]', e instanceof Error ? e.stack ?? e.message : e);
    if (e instanceof PlaidError) return json({ error: e.message, code: e.code }, e.status >= 400 && e.status < 600 ? e.status : 500);
    return json({ error: e instanceof Error ? e.message : 'Could not start bank linking' }, 500);
  }
};
