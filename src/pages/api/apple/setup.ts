import type { APIRoute } from 'astro';
import { json } from '@/lib/http';
import { appleKeyFor, appleStatus } from '@/lib/apple-store';
import { linkStatus } from '@/lib/link-store';
import { appleScript } from '@/lib/apple-script';
import { env } from '@/lib/auth';

// The script must always post to the app's main address, not a one-off deployment link someone happened to open.
function appUrl(fallback: string): string {
  for (const v of [env('APP_URL'), env('PLAID_REDIRECT_URI')]) {
    try {
      const u = new URL(v);
      if (u.protocol === 'https:') return u.origin;
    } catch { /* not set */ }
  }
  return fallback;
}

// The signed-in person's own Gmail script (with their key filled in) and how many receipts it has sent.
export const GET: APIRoute = async ({ locals, url }) => {
  if (locals.user.demo) return json({ error: 'Not available in the demo.' }, 403);
  try {
    const email = locals.user.email;
    const link = await linkStatus(email);
    return json({ script: appleScript(appUrl(url.origin), appleKeyFor(email)), ...(await appleStatus(email)), linkEmails: link.emails, linkLastSent: link.lastSent });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not prepare the script' }, 500);
  }
};
