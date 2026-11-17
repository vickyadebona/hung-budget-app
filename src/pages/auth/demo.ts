import type { APIRoute } from 'astro';
import { COOKIE, DEMO_HOURS, createSession, demoEnabled } from '../../lib/auth';
import { DEMO_USER } from '../../lib/demo';

// Starts a demo session. It replaces any real sign-in on this browser, so the real data is not one tap away.
export const POST: APIRoute = async ({ cookies, url, redirect }) => {
  if (!demoEnabled()) return new Response('Not found', { status: 404 });
  cookies.set(COOKIE, createSession(DEMO_USER.email, DEMO_USER.name, true), {
    httpOnly: true,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
    path: '/',
    maxAge: DEMO_HOURS * 3600,
  });
  return redirect('/', 303);
};
