import type { APIRoute } from 'astro';
import { json } from '@/lib/http';
import { PlaidError, sandboxConnect, syncAll } from '@/lib/plaid';

export const POST: APIRoute = async ({ locals }) => {
  try {
    const itemId = await sandboxConnect(locals.user.email);
    return json({ itemId, results: await syncAll() });
  } catch (e) {
    if (e instanceof PlaidError) return json({ error: e.message, code: e.code }, e.status === 400 ? 400 : 502);
    return json({ error: e instanceof Error ? e.message : 'Could not link the sandbox bank' }, 500);
  }
};
