import type { APIRoute } from 'astro';
import { json } from '@/lib/http';
import { appleKeyFor, appleStatus } from '@/lib/apple-store';
import { linkStatus } from '@/lib/link-store';
import { appleScript, appUrl } from '@/lib/apple-script';

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
