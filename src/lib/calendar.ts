/**
 * Puts upcoming payments on a month calendar: recurring charges (repeated by their schedule), card payment
 * due dates, and 0%/deferred amounts ending. Pure functions: summary rows in, dated items out.
 */

export type CalendarKind = 'recurring' | 'card' | 'deferral';
export interface CalendarItem {
  date: string; // YYYY-MM-DD
  label: string;
  amount: number | null;
  kind: CalendarKind;
  estimated: boolean; // a repeat worked out from the schedule, not a date the bank or a receipt gave
  note?: string;
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const parts = (date: string) => date.split('-').map(Number) as [number, number, number];
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(date + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

/** Same day of the month, n months on; the 31st becomes the last day of a shorter month. */
export function addMonths(date: string, n: number, day = parts(date)[2]): string {
  const [y, m] = parts(date);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return iso(ny, nm, Math.min(day, daysIn(ny, nm)));
}

/** How to get from one charge to the next, for every schedule name the app uses. null = cannot tell. */
export function stepFor(frequency: string): ((date: string, day: number) => string) | null {
  const f = frequency.toLowerCase();
  const weeks = f.match(/^every-(\d+)-weeks?$/);
  if (weeks) return (d) => addDays(d, 7 * Number(weeks[1]));
  const months = f.match(/^every-(\d+)-months?$/);
  if (months) return (d, day) => addMonths(d, Number(months[1]), day);
  switch (f) {
    case 'weekly': return (d) => addDays(d, 7);
    case 'biweekly': return (d) => addDays(d, 14);
    case 'semi_monthly': case 'twice-monthly': return (d) => addDays(d, 15);
    case 'monthly': return (d, day) => addMonths(d, 1, day);
    case 'quarterly': return (d, day) => addMonths(d, 3, day);
    case 'yearly': case 'annually': return (d, day) => addMonths(d, 12, day);
    default: return null;
  }
}

/** Every date a charge falls on in [from, to], starting from its next known date. */
export function datesBetween(next: string, frequency: string, from: string, to: string): string[] {
  const step = stepFor(frequency);
  const day = parts(next)[2];
  const out: string[] = [];
  let d = next;
  for (let i = 0; i < 400 && d <= to; i++) {
    if (d >= from) out.push(d);
    if (!step) break;
    d = step(d, day);
  }
  return out;
}

export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  return { from: iso(y, m, 1), to: iso(y, m, daysIn(y, m)) };
}

interface RecurringRow { label: string; amount: number; frequency: string; nextDate: string | null; source?: string }
interface CardRow { name: string; mask: string | null; details: { next_due: string | null; minimum: number | null } | null; state?: string }
interface DeferralRow { name: string; mask: string | null; plans: { ends: string; balance: number; kind: string; label: string }[] }

/** Everything due in one month (YYYY-MM), nothing before `today`, sorted by date then amount. */
export function calendarItems(month: string, today: string, recurring: RecurringRow[], cards: CardRow[], deferrals: DeferralRow[]): CalendarItem[] {
  const { from: start, to } = monthBounds(month);
  const from = start < today ? today : start;
  if (from > to) return [];
  const items: CalendarItem[] = [];

  for (const r of recurring) {
    if (!r.nextDate || r.amount <= 0) continue;
    for (const date of datesBetween(r.nextDate, r.frequency, from, to)) {
      items.push({ date, label: r.label, amount: r.amount, kind: 'recurring', estimated: date !== r.nextDate });
    }
  }

  for (const c of cards) {
    const due = c.details?.next_due;
    if (!due || c.state === 'paid' || c.state === 'nothing-due') continue;
    const name = `${c.name}${c.mask ? ' ··' + c.mask : ''}`;
    for (const date of datesBetween(due, 'monthly', from, to)) {
      const first = date === due;
      items.push({ date, label: name, amount: first ? c.details!.minimum : null, kind: 'card', estimated: !first, note: first ? 'minimum due' : 'payment due (estimated date)' });
    }
  }

  for (const c of deferrals) {
    for (const p of c.plans) {
      if (p.ends < from || p.ends > to || p.balance <= 0) continue;
      items.push({
        date: p.ends, label: `${c.name}${c.mask ? ' ··' + c.mask : ''}`, amount: p.balance, kind: 'deferral', estimated: false,
        note: `${p.label || (p.kind === 'deferred' ? 'Deferred interest' : '0% offer')} ends: pay off by today`,
      });
    }
  }

  return items.sort((a, b) => a.date.localeCompare(b.date) || (b.amount ?? 0) - (a.amount ?? 0));
}

/** What a day adds up to. Deferred/0% end dates are reminders, not extra spending, so they are left out. */
export function dayTotal(items: CalendarItem[]): number {
  return items.filter((i) => i.kind !== 'deferral').reduce((n, i) => n + (i.amount ?? 0), 0);
}
