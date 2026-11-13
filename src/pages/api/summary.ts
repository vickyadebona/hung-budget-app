import type { APIRoute } from 'astro';
import { json } from '@/lib/http';
import { getSummary } from '@/lib/summary';

export const GET: APIRoute = async () => {
  try {
    return json(await getSummary());
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not load your data' }, 500);
  }
};
