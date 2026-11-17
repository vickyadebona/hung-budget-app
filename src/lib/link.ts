/**
 * Reads emails from Link (Stripe's saved-payment wallet, notifications@link.com) into charge and
 * "coming up" events. Pure text in, events out; link-store.ts saves them and works out the subscriptions.
 *
 * Link sends three useful kinds of email:
 *  - a monthly summary: "Notion Labs Renewed Oct 6 $24.00 ... Unassociated Expected Nov 13 $5.00 monthly"
 *    (only the top five purchases and a few upcoming payments; the rest is "+ 3 more")
 *  - a receipt for one purchase: "Sticker Mule, LLC $201.75 ... Date August 6, 2026"
 *  - a new subscription: "Your Cal AI subscription ... will be charged $29.99 every year starting on April 11, 2026"
 */
import { inferMonths, parseDate } from './apple.ts';

export type LinkEvent =
  | { kind: 'charge'; name: string; amount: number; date: string; renewed: boolean }
  | { kind: 'upcoming'; name: string; amount: number; date: string; months: number | null; cadence: string | null };

const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const CADENCE = '(monthly|yearly|annually|weekly|every (?:\\d+ )?(?:weeks?|months?|years?))';

/** Remove anything personal or useless before reading (or sending): links, email addresses, card numbers, names. */
export function cleanLinkText(text: string): string {
  return text
    .replace(/\]\([^)]*\)/g, ' ')
    .replace(/\(?https?:\/\/\S+\)?/g, ' ')
    .replace(/[^\s@]+@[^\s@]+\.[a-z]{2,}/gi, ' ')
    .replace(/\b(?:Payment|Declined|Account|Name|Card)\s*\n[^\n]*/g, ' ') // "Name\nJane Doe", "Payment\nVisa •••• 1234"
    .replace(/[•·*]{2,}\s*\d{2,4}/g, ' ') // masked card digits
    .replace(/\((?:visa|mastercard|amex|discover)[^)]*\)/gi, ' ')
    .replace(/[͏​‌­ ]+/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ')
    .slice(0, 8000)
    .trim();
}

const money = (s: string) => Number(s.replace(/,/g, ''));

/** "Oct 6" in an email received on 2026-11-05 is 2026-10-06; "Jan 3" in a December email is next year. */
export function resolveDate(mon: string, day: string, received: string): string | null {
  const m = MON[mon.slice(0, 3).toLowerCase()];
  const d = Number(day);
  if (!m || !d || d > 31) return null;
  const base = Date.parse(received.slice(0, 10));
  const y = Number(received.slice(0, 4));
  let best: string | null = null;
  let bestGap = Infinity;
  for (const year of [y - 1, y, y + 1]) {
    const iso = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const gap = Math.abs(Date.parse(iso) - base);
    if (gap < bestGap) { best = iso; bestGap = gap; }
  }
  return best;
}

/** How many months between charges: "monthly" 1, "every 4 weeks" ~0.92, "every year" 12. */
export function cadenceMonths(cadence: string | null): number | null {
  if (!cadence) return null;
  const c = cadence.toLowerCase().trim();
  if (c === 'monthly') return 1;
  if (c === 'yearly' || c === 'annually') return 12;
  if (c === 'weekly') return 0.25;
  const m = c.match(/^every (\d+ )?(week|month|year)s?$/);
  if (!m) return null;
  const n = m[1] ? Number(m[1]) : 1;
  return m[2] === 'week' ? Math.round(((n * 7) / 30.44) * 1000) / 1000 : m[2] === 'month' ? n : n * 12;
}

const tidyName = (n: string) => n.replace(/^[\s:;,.\-–+]+|[\s:;,\-–]+$/g, '').replace(/\s+/g, ' ').slice(0, 80);

/** Events in one Link email. `received` is when the email arrived (ISO). Unknown emails give nothing. */
export function parseLinkEmail(subject: string, rawText: string, received: string): LinkEvent[] {
  const text = cleanLinkText(rawText);
  const events: LinkEvent[] = [];

  // A new subscription.
  const sub = text.match(new RegExp(`Your ((?:(?!Your )[^.])+?) subscription(?: for (.+?))? (?:has been|is) confirmed.*?charged \\$(\\d[\\d,]*(?:\\.\\d{2})?) ${CADENCE} starting on ([A-Za-z]+\\.? \\d{1,2}, \\d{4})`, 'i'));
  if (sub) {
    const date = parseDate(sub[5]);
    if (date) events.push({ kind: 'upcoming', name: tidyName(sub[1]), amount: money(sub[3]), date, months: cadenceMonths(sub[4]), cadence: sub[4].toLowerCase() });
    return events;
  }

  // The monthly summary.
  if (/transaction summary|account activity/i.test(subject) || /Here's what you spent last month/i.test(text)) {
    const entry = new RegExp(`([^$]+?)\\s+(?:(Renewed|Renews|Expected)\\s+)?${MONTH}\\.? (\\d{1,2})\\s+\\$(\\d[\\d,]*(?:\\.\\d{2})?)(?:\\s+${CADENCE})?`, 'gi');
    const section = (from: RegExp, to: RegExp) => {
      const a = text.search(from);
      if (a < 0) return '';
      const rest = text.slice(a).replace(from, ' ');
      const b = rest.search(to);
      return b < 0 ? rest : rest.slice(0, b);
    };
    const spent = section(/Here's what you spent last month/i, /\+ ?\d+ more|View details|Your upcoming activity/i);
    for (const m of spent.matchAll(entry)) {
      const date = resolveDate(m[3], m[4], received);
      const name = tidyName(m[1]);
      if (date && name) events.push({ kind: 'charge', name, amount: money(m[5]), date, renewed: /renew/i.test(m[2] ?? '') });
    }
    const upcoming = section(/Review your (?:upcoming )?\w+ (?:payments|subscriptions)/i, /\+ ?\d+ more|View upcoming/i);
    for (const m of upcoming.matchAll(entry)) {
      const date = resolveDate(m[3], m[4], received);
      const name = tidyName(m[1]);
      if (date && name) events.push({ kind: 'upcoming', name, amount: money(m[5]), date, months: cadenceMonths(m[6] ?? null), cadence: m[6]?.toLowerCase() ?? null });
    }
    return events;
  }

  // A receipt for one purchase (including "your backup payment was charged").
  if (/purchase at|backup payment|receipt|payment to/i.test(subject) || /View purchase/i.test(text)) {
    const m = text.match(/^(.+?) \$(\d[\d,]*(?:\.\d{2})?)/);
    if (m) {
      const stated = text.match(/Date ([A-Za-z]+\.? \d{1,2}, \d{4})/);
      const date = (stated && parseDate(stated[1])) || received.slice(0, 10);
      events.push({ kind: 'charge', name: tidyName(m[1]), amount: money(m[2]), date, renewed: false });
    }
  }
  return events;
}

/* ---------- from events to subscriptions ---------- */

export const linkKey = (name: string) => name.toLowerCase().replace(/\b(inc|llc|ltd|corp|co|as|labs?)\b\.?/g, '').replace(/[^a-z0-9]+/g, '');

export interface LinkSub {
  key: string;
  name: string;
  price: number;
  previousPrice: number | null;
  months: number | null;
  cadence: string | null;
  lastCharged: string | null;
  next: string | null;
}

const addMonths = (date: string, months: number) => {
  const ms = Date.parse(date + 'T12:00:00Z');
  return new Date(ms + months * 30.44 * 86400000).toISOString().slice(0, 10);
};
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;
const addDays = (date: string, n: number) => new Date(Date.parse(date + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/**
 * Subscriptions from one person's events. Something is a subscription when Link called a charge a renewal,
 * or listed it as coming up. Link's summaries leave out purchases past the top five, so the gaps seen
 * between charges can be too long: the shortest gap is used, and the next date may roll forward
 * up to two cycles past the last charge seen.
 */
export function linkSubscriptions(events: (LinkEvent & { name: string })[], today: string): LinkSub[] {
  const byKey = new Map<string, LinkEvent[]>();
  for (const e of events) {
    const k = linkKey(e.name);
    if (k) (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(e);
  }
  const graceFrom = addMonths(today, -0.23); // about a week back
  const subs: LinkSub[] = [];
  for (const [key, list] of byKey) {
    const charges = list.filter((e): e is Extract<LinkEvent, { kind: 'charge' }> => e.kind === 'charge').sort((a, b) => a.date.localeCompare(b.date));
    const ups = list.filter((e): e is Extract<LinkEvent, { kind: 'upcoming' }> => e.kind === 'upcoming').sort((a, b) => a.date.localeCompare(b.date));
    if (!charges.some((c) => c.renewed) && ups.length === 0) continue; // one-off purchases

    const lastUp = ups.at(-1) ?? null;
    const lastCharge = charges.at(-1) ?? null;
    let months = [...ups].reverse().find((u) => u.months !== null)?.months ?? null;
    const cadence = [...ups].reverse().find((u) => u.cadence)?.cadence ?? null;
    if (months === null) {
      const dates = [...new Set(charges.map((c) => c.date))];
      let shortest = Infinity;
      for (let i = 1; i < dates.length; i++) shortest = Math.min(shortest, days(dates[i - 1], dates[i]));
      if (Number.isFinite(shortest)) months = inferMonths('2000-01-01', addDays('2000-01-01', shortest));
    }

    // The newest amount wins; an actual charge beats an announcement for the same day.
    const priced = [...charges.map((c) => ({ date: c.date, amount: c.amount, rank: 1 })), ...ups.map((u) => ({ date: u.date, amount: u.amount, rank: 0 }))]
      .sort((a, b) => a.date.localeCompare(b.date) || a.rank - b.rank);
    const price = priced.at(-1)!.amount;
    const before = priced.slice(0, -1).reverse().find((p) => Math.abs(p.amount - price) > 0.009);

    let next: string | null = null;
    if (lastUp && lastUp.date >= graceFrom && (!lastCharge || lastUp.date > lastCharge.date)) next = lastUp.date;
    else if (months) {
      // From the latest date seen, one cycle on; then at most two more for charges the summaries left out.
      const from = [lastCharge?.date, lastUp?.date].filter((d): d is string => !!d).sort().at(-1)!;
      next = addMonths(from, months);
      for (let i = 0; i < 2 && next < graceFrom; i++) next = addMonths(next, months);
    }

    if (next ? next < graceFrom : !(lastCharge && days(lastCharge.date, today) <= 35)) continue; // looks stopped
    subs.push({
      key,
      name: key === 'unassociated' ? 'Unnamed charge (Link)' : (lastUp ?? lastCharge)!.name,
      price,
      previousPrice: before ? before.amount : null,
      months,
      cadence,
      lastCharged: lastCharge?.date ?? null,
      next,
    });
  }
  return subs.sort((a, b) => a.name.localeCompare(b.name));
}


/** The frequency label the Overview understands. */
export function linkFrequency(months: number | null, cadence: string | null): string {
  if (cadence && /^every \d+ /.test(cadence)) return cadence.replace(/s?$/, 's').replace(/ /g, '-').replace(/ss$/, 's');
  if (months === 0.25) return 'weekly';
  if (months === 1) return 'monthly';
  if (months === 3) return 'quarterly';
  if (months === 6) return 'every-6-months';
  if (months === 12) return 'yearly';
  return 'repeats';
}

/** Same shop on the bank statement and in Link? "NOTION LABS" / "Notion", "STRAWBERRY ME" / "Strawberry.me". */
export function sameMerchant(bankLabel: string, linkName: string): boolean {
  const a = linkKey(bankLabel);
  const b = linkKey(linkName);
  if (a.length < 4 || b.length < 4) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const first = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).find((w) => w.length >= 4) ?? '';
  const fa = first(bankLabel);
  const fb = first(linkName);
  return (!!fb && a.startsWith(fb)) || (!!fa && b.startsWith(fa));
}
