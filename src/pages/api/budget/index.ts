import type { APIRoute } from 'astro';
import { json } from '@/lib/http';
import { getBudget } from '@/lib/budget';
import { isMonth } from '@/lib/budget-rules';

export const GET: APIRoute = async ({ url }) => {
  const month = url.searchParams.get('month');
  if (!isMonth(month)) return json({ error: 'month must look like 2026-11' }, 400);
  try {
    return json(await getBudget(month));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not load the budget' }, 500);
  }
};
