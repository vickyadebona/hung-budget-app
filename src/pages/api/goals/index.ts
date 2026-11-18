import type { APIRoute } from 'astro';
import { json } from '@/lib/http';
import { getGoals } from '@/lib/goals';

export const GET: APIRoute = async () => {
  try {
    return json(await getGoals());
  } catch (e) {
    console.error('[goals]', e instanceof Error ? e.stack ?? e.message : e);
    return json({ error: 'Could not load goals' }, 500);
  }
};
