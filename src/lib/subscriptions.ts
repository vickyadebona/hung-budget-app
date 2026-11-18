/**
 * Decides, for each recurring charge, whether it is still running, has probably stopped, or was
 * switched to a yearly plan. Your own marks always win over the guesses. Pure, so it is easy to test.
 */
import { merchantKey } from './recurring.ts';

export type Mark = 'cancelled' | 'yearly' | 'monthly' | 'active' | 'not-subscription';
export const MARKS: Mark[] = ['cancelled', 'yearly', 'monthly', 'active', 'not-subscription'];

export interface Row {
  id: string;
  label: string;
  frequency: string;
  amount: number;
  monthly: number;
  lastDate: string | null;
  nextDate: string | null;
  source: 'plaid' | 'found' | 'apple' | 'link';
  [extra: string]: unknown;
}

export interface Charge { date: string; amount: number }

/** The key your marks are saved under: the cleaned-up merchant name, or the Apple subscription's own id. */
export function markKey(r: Pick<Row, 'id' | 'label' | 'source'>): string {
  return r.source === 'apple' || r.source === 'link' ? r.id : 'm:' + merchantKey({ name: r.label });
}

const PERIOD_DAYS: Record<string, number> = {
  WEEKLY: 7, weekly: 7, BIWEEKLY: 14, biweekly: 14, SEMI_MONTHLY: 15, MONTHLY: 30.4, monthly: 30.4,
  quarterly: 91.3, 'every-6-months': 182.6, ANNUALLY: 365.25, yearly: 365.25,
};
const GRACE_DAYS = (period: number) => Math.min(30, Math.max(3, Math.round(period * 0.25)));
const DAY = 86400000;
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** A big charge after a run of small ones at the same place: most likely a switch to a yearly plan. */
export function switchedToYearly(charges: Charge[]): Charge | null {
  if (charges.length < 3) return null;
  const sorted = [...charges].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1];
  const before = sorted.slice(0, -1).slice(-6);
  const usual = median(before.map((c) => c.amount));
  return usual > 0 && last.amount >= usual * 6 ? last : null;
}

/** No charge for well past when the next one was due. Apple and Link items are excluded: their emails already say. */
export function looksCancelled(r: Row, today: string): boolean {
  if (r.source === 'apple' || r.source === 'link' || !r.lastDate) return false;
  const period = PERIOD_DAYS[r.frequency];
  if (!period) return false;
  const daysSince = (Date.parse(today) - Date.parse(r.lastDate)) / DAY;
  return daysSince > period + GRACE_DAYS(period);
}

export type Status = 'active' | 'possibly-cancelled' | 'cancelled' | 'hidden';
export type Judged<R extends Row> = R & { key: string; status: Status; mark: Mark | null; switchedToYearly: boolean };

export function judge<R extends Row>(rows: R[], marks: Map<string, Mark>, chargesByKey: Map<string, Charge[]>, today: string): Judged<R>[] {
  return rows.map((r) => {
    const key = markKey(r);
    const mark = marks.get(key) ?? null;
    let row: R = { ...r };
    let switched = false;

    const yearlyFrom = (charge: Charge | null) => {
      const amount = charge?.amount ?? r.amount;
      const last = charge?.date ?? r.lastDate;
      row = { ...row, frequency: 'yearly', amount, monthly: amount / 12, lastDate: last, nextDate: last ? addDays(last, 365) : null };
    };

    if (mark === 'yearly') {
      const charges = chargesByKey.get(merchantKey({ name: r.label })) ?? [];
      const latest = [...charges].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
      yearlyFrom(latest && latest.amount >= r.amount ? latest : null);
    } else if (mark === 'monthly') {
      row = { ...row, frequency: 'monthly', monthly: r.amount };
    } else if (!mark && r.source !== 'apple' && r.source !== 'link') {
      const big = switchedToYearly(chargesByKey.get(merchantKey({ name: r.label })) ?? []);
      if (big) { yearlyFrom(big); switched = true; }
    }

    let status: Status = 'active';
    if (mark === 'cancelled') status = 'cancelled';
    else if (mark === 'not-subscription') status = 'hidden';
    else if (mark !== 'active' && looksCancelled(row, today)) status = 'possibly-cancelled';
    return { ...row, key, status, mark, switchedToYearly: switched };
  });
}
