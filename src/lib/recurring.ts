/**
 * Our own recurring-charge finder. Plaid has one too; this is the second opinion that catches
 * charges Plaid misses (new subscriptions with only two charges, yearly renewals, small amounts).
 * Plain rules only: same merchant, similar amount, steady gap between charges.
 */
export interface Txn {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  merchant?: string | null;
  amount: number; // positive = money out
}

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

export interface Candidate {
  key: string;
  label: string;
  cadence: Cadence;
  amount: number; // most recent charge
  count: number;
  lastDate: string;
  nextDate: string;
  priceChanged: boolean;
}

const CADENCES: { name: Cadence; days: number; slack: number }[] = [
  { name: 'weekly', days: 7, slack: 1 },
  { name: 'biweekly', days: 14, slack: 2 },
  { name: 'monthly', days: 30.4, slack: 4 },
  { name: 'quarterly', days: 91.3, slack: 8 },
  { name: 'yearly', days: 365.25, slack: 15 },
];

const STATE_SUFFIX =
  / (al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc)$/;

/** "APPLE.COM/BILL 866-712-7753 CA" and "Apple.com/Bill" should land in the same bucket. */
export function merchantKey(t: Pick<Txn, 'name' | 'merchant'>): string {
  const raw = (t.merchant || t.name || '').toLowerCase();
  return raw
    .replace(/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/g, ' ') // phone numbers
    .replace(/[#*]\s*[a-z0-9]{4,}/g, ' ') // reference codes
    .replace(/\b\d{4,}\b/g, ' ') // long numbers
    .replace(/\b(inc|llc|co|corp|ltd|payment|purchase|pos|debit|card|recurring|autopay)\b/g, ' ')
    .replace(/[^a-z0-9.&/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(STATE_SUFFIX, ''); // trailing "CA", "NY" from card statements
}

const DAY = 86400000;
const toMs = (d: string) => Date.parse(d + 'T00:00:00Z');
const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function findRecurring(txns: Txn[], today = toDate(Date.now())): Candidate[] {
  const groups = new Map<string, Txn[]>();
  for (const t of txns) {
    if (!(t.amount > 0)) continue; // charges only
    const key = merchantKey(t);
    if (!key) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }

  const out: Candidate[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));

    // Collapse same-day duplicates (pending + posted copies of one charge).
    const charges = list.filter((t, i) => i === 0 || t.date !== list[i - 1].date);
    if (charges.length < 2) continue;

    const gaps = charges.slice(1).map((t, i) => (toMs(t.date) - toMs(charges[i].date)) / DAY);
    const gap = median(gaps);
    const cadence = CADENCES.find((c) => Math.abs(gap - c.days) <= c.slack);
    if (!cadence) continue;

    // Most gaps must agree with the cadence; one skipped or late charge is tolerated.
    const steady = gaps.filter((g) => Math.abs(g - cadence.days) <= cadence.slack * 1.5).length;
    if (steady / gaps.length < 0.7) continue;

    // Amounts must be close to each other, otherwise it's a habit (coffee), not a subscription.
    const amounts = charges.map((t) => t.amount);
    const mid = median(amounts);
    const close = amounts.filter((a) => Math.abs(a - mid) <= Math.max(1, mid * 0.2)).length;
    if (close / amounts.length < 0.7) continue;

    // Two charges alone are weak evidence for short cadences.
    if (charges.length === 2 && (cadence.name === 'weekly' || cadence.name === 'biweekly')) continue;

    const last = charges[charges.length - 1];
    const prev = charges[charges.length - 2];
    // Stopped charging? Skip if the next expected date is long gone.
    const next = toMs(last.date) + cadence.days * DAY;
    if (toMs(today) - next > cadence.days * DAY) continue;

    out.push({
      key,
      label: last.merchant || last.name,
      cadence: cadence.name,
      amount: last.amount,
      count: charges.length,
      lastDate: last.date,
      nextDate: toDate(next),
      priceChanged: Math.abs(last.amount - prev.amount) > 0.01,
    });
  }
  return out.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}

const PER_MONTH: Record<string, number> = {
  weekly: 52 / 12, WEEKLY: 52 / 12,
  biweekly: 26 / 12, BIWEEKLY: 26 / 12,
  SEMI_MONTHLY: 2,
  monthly: 1, MONTHLY: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12, ANNUALLY: 1 / 12,
};

/** What a charge costs per month, whatever its real schedule is. */
export function monthlyCost(amount: number, frequency: string): number {
  return amount * (PER_MONTH[frequency] ?? 1);
}
