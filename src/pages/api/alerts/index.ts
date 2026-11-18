import type { APIRoute } from 'astro';
import { json, readJson, str } from '@/lib/http';
import { db } from '@/lib/db';
import { dismissAlert, emailOn, getAlerts, lastDigest, saveAlertSettings, setEmailOn } from '@/lib/alert-store';

/** Current alerts, the household's alert settings, and whether the signed-in person gets the daily email. */
export const GET: APIRoute = async ({ locals }) => {
  try {
    const sql = await db();
    const email = locals.user.email;
    const [data, on, last] = await Promise.all([getAlerts(), emailOn(sql, email), lastDigest(email)]);
    return json({ ...data, email: { on, last } });
  } catch (e) {
    console.error('[alerts]', e instanceof Error ? e.stack ?? e.message : e);
    return json({ error: 'Could not load alerts' }, 500);
  }
};

/**
 *   { dismiss: id }   hide an alert for both of you      { restore: id }   bring it back
 *   { settings: { largeCharge?, billDays?, deferralDays? } }
 *   { email: true | false }   the daily email for the signed-in person
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const body = await readJson(request);
  if (!body) return json({ error: 'Nothing sent' }, 400);
  try {
    const sql = await db();
    const dismiss = str(body.dismiss);
    const restore = str(body.restore);
    if (dismiss || restore) {
      const id = (dismiss ?? restore)!.slice(0, 200);
      await dismissAlert(id, locals.user.email, Boolean(restore));
      return json({ ok: true });
    }
    if (typeof body.email === 'boolean') {
      if (locals.user.demo) return json({ error: 'Emails are not sent from the demo.' }, 403);
      await setEmailOn(sql, locals.user.email, body.email);
      return json({ ok: true });
    }
    if (body.settings && typeof body.settings === 'object') {
      const s = body.settings as Record<string, unknown>;
      const num = (v: unknown, min: number, max: number, what: string) => {
        if (v === undefined) return undefined;
        const n = Number(v);
        if (!Number.isFinite(n) || n < min || n > max) throw new RangeError(`${what} must be between ${min} and ${max}`);
        return Math.round(n * 100) / 100;
      };
      const saved = await saveAlertSettings(sql, Object.fromEntries(Object.entries({
        largeCharge: num(s.largeCharge, 1, 1_000_000, 'The large purchase amount'),
        billDays: num(s.billDays, 0, 14, 'Days before a bill'),
        deferralDays: num(s.deferralDays, 1, 120, 'Days before a 0% offer ends'),
      }).filter(([, v]) => v !== undefined)));
      return json({ settings: saved });
    }
    return json({ error: 'Nothing to change' }, 400);
  } catch (e) {
    if (e instanceof RangeError) return json({ error: e.message }, 400);
    console.error('[alerts]', e instanceof Error ? e.stack ?? e.message : e);
    return json({ error: 'Could not save' }, 500);
  }
};
