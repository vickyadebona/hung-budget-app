import type { APIRoute } from 'astro';
import { json } from '@/lib/http';
import { syncAll } from '@/lib/plaid';

export const POST: APIRoute = async () => {
  try {
    return json({ results: await syncAll() });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Sync failed' }, 500);
  }
};
