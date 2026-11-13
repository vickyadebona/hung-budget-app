import type { APIRoute } from 'astro';
import { json, readJson } from '@/lib/http';
import { exportBudget, restoreBudget } from '@/lib/budget';

// GET downloads the plan as a file. POST { backup } loads one back in.
export const GET: APIRoute = async () => {
  const body = JSON.stringify(await exportBudget(), null, 2);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="budget-backup-${day}.json"`, 'cache-control': 'no-store' },
  });
};

export const POST: APIRoute = async ({ request }) => {
  const body = await readJson(request);
  try {
    return json({ restored: await restoreBudget(body?.backup) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not restore' }, 400);
  }
};
