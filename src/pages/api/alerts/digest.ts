import type { APIRoute } from 'astro';
import { json } from '@/lib/http';
import { emailForKey } from '@/lib/apple-store';
import { digestFor } from '@/lib/alert-store';
import { appUrl } from '@/lib/apple-script';

// Called once a day by each person's Gmail script, with their personal key. The script emails the result to
// that same Gmail account, so the app never needs an email service or anyone's password.
export const POST: APIRoute = async ({ request, url }) => {
  const email = emailForKey(request.headers.get('x-budget-key') ?? '');
  if (!email) return json({ error: 'Unknown key. Copy a fresh script from Settings in the budget app.' }, 401);
  try {
    const mail = await digestFor(email, appUrl(url.origin));
    console.log('[digest]', JSON.stringify({ who: email, alerts: mail?.count ?? 0 }));
    return json({ email: mail });
  } catch (e) {
    console.error('[digest]', e instanceof Error ? e.stack ?? e.message : e);
    return json({ error: 'Could not build the alert email' }, 500);
  }
};
