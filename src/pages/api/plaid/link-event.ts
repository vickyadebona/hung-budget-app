import type { APIRoute } from 'astro';
import { json, readJson } from '@/lib/http';

const pick = (v: unknown) => (typeof v === 'string' ? v.slice(0, 300) : undefined);

// Plaid's bank picker reports exits and errors in the browser; this copies the codes into the server log.
export const POST: APIRoute = async ({ request, locals }) => {
  const b = (await readJson(request)) ?? {};
  const err = (b.error && typeof b.error === 'object' ? b.error : {}) as Record<string, unknown>;
  const meta = (b.metadata && typeof b.metadata === 'object' ? b.metadata : {}) as Record<string, unknown>;
  const inst = (meta.institution && typeof meta.institution === 'object' ? meta.institution : {}) as Record<string, unknown>;
  console.error('[link]', JSON.stringify({
    who: locals.user.email,
    event: pick(b.event),
    error_type: pick(err.error_type), error_code: pick(err.error_code), error_message: pick(err.error_message), display_message: pick(err.display_message),
    status: pick(meta.status), institution: pick(inst.name), institution_id: pick(inst.institution_id),
    link_session_id: pick(meta.link_session_id), request_id: pick(meta.request_id),
  }));
  return json({ ok: true });
};
