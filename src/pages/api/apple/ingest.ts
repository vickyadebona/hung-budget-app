import type { APIRoute } from 'astro';
import { json, readJson } from '@/lib/http';
import { emailForKey, ingestReceipts, type IncomingReceipt } from '@/lib/apple-store';

// Called by the Gmail script, not a browser. It proves who it is with the personal key instead of a sign-in cookie.
export const POST: APIRoute = async ({ request }) => {
  const email = emailForKey(request.headers.get('x-budget-key') ?? '');
  if (!email) return json({ error: 'Unknown key. Copy a fresh script from Settings in the budget app.' }, 401);
  const body = await readJson(request);
  const raw = Array.isArray(body?.receipts) ? body.receipts : null;
  if (!raw) return json({ error: 'Expected { receipts: [...] }' }, 400);
  if (raw.length > 50) return json({ error: 'Send at most 50 receipts at a time' }, 413);
  const receipts: IncomingReceipt[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const { id, date, subject, text } = r as Record<string, unknown>;
    if (typeof id !== 'string' || typeof date !== 'string' || typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(date)) continue;
    receipts.push({ id: id.slice(0, 100), date: date.slice(0, 30), subject: typeof subject === 'string' ? subject.slice(0, 200) : undefined, text: text.slice(0, 10_000) });
  }
  try {
    const result = await ingestReceipts(email, receipts);
    console.log('[apple]', JSON.stringify({ who: email, ...result }));
    return json(result);
  } catch (e) {
    console.error('[apple]', e instanceof Error ? e.stack ?? e.message : e);
    return json({ error: 'Could not save receipts' }, 500);
  }
};
