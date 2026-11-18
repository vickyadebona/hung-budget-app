import crypto from 'node:crypto';
import type { APIRoute } from 'astro';
import { env } from '@/lib/auth';
import { json } from '@/lib/http';
import { refreshPrices } from '@/lib/wishlist';

// Vercel calls this once a day (see vercel.json) and sends "Authorization: Bearer <CRON_SECRET>".
export const GET: APIRoute = async ({ request }) => {
  const secret = env('CRON_SECRET');
  const got = request.headers.get('authorization') ?? '';
  const want = `Bearer ${secret}`;
  const ok = secret.length >= 16 && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
  if (!ok) return json({ error: 'Not allowed' }, 401);
  return json(await refreshPrices(undefined, 60));
};
