import { defineMiddleware } from 'astro:middleware';
import { COOKIE, readSession } from './lib/auth';
import { runAsDemo } from './lib/db';

// These check their own secret instead of a sign-in: /api/cron/ is called by Vercel, the two ingest routes by each person's Gmail script.
const PUBLIC_PREFIXES = ['/auth/', '/favicon', '/_astro/', '/api/cron/', '/api/apple/ingest', '/api/link/ingest'];

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return next();

  let session = null;
  try {
    session = readSession(context.cookies.get(COOKIE)?.value);
  } catch {
    session = null;
  }

  if (!session) {
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Not signed in' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    return context.redirect('/auth/login');
  }

  // Block cross-site writes. Browsers send Origin on POST/PUT/DELETE; its host must match the host
  // this request was addressed to (compared by host, so localhost vs 127.0.0.1 and proxies still work).
  if (pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(context.request.method)) {
    const h = context.request.headers;
    const origin = h.get('origin');
    let sameSite = true;
    if (origin) {
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = '';
      }
      const hosts = [h.get('host'), h.get('x-forwarded-host'), context.url.host].filter(Boolean);
      sameSite = hosts.includes(originHost);
    }
    if (h.get('sec-fetch-site') === 'cross-site') sameSite = false;
    if (!sameSite) {
      return new Response(JSON.stringify({ error: 'Bad origin' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  context.locals.user = session;
  // Demo viewers get the made-up database for the whole request; the real one is out of reach.
  return session.demo === true ? runAsDemo(() => next()) : next();
});
