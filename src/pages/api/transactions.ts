import type { APIRoute } from 'astro';
import { json } from '@/lib/http';
import { isMonth } from '@/lib/budget-rules';
import { getTransactions } from '@/lib/transactions';

export const GET: APIRoute = async ({ url }) => {
  const month = url.searchParams.get('month');
  if (!isMonth(month)) return json({ error: 'month must look like 2026-11' }, 400);
  try {
    return json(await getTransactions(month));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not load transactions' }, 500);
  }
};
