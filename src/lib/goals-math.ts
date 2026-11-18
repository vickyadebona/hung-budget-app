/** Pure goal maths, kept free of the database so it can be tested on its own. */

export interface GoalAlloc {
  id: string;
  target: number;
}

/**
 * Several goals can point at one savings account. The account's balance fills them in order:
 * the first goal is filled up to its target, then the next, and so on. Anything left over is "extra".
 * A negative balance counts as nothing.
 */
export function allocate(balance: number, goals: GoalAlloc[]): { alloc: Map<string, number>; extra: number } {
  let left = Math.max(0, balance);
  const alloc = new Map<string, number>();
  for (const g of goals) {
    const take = Math.min(left, Math.max(0, g.target));
    alloc.set(g.id, round(take));
    left -= take;
  }
  return { alloc, extra: round(left) };
}

const round = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;

/** Whole months from today to the target date, at least 1. Null when there is no date. */
export function monthsLeft(targetDate: string | null, today: string): number | null {
  if (!targetDate) return null;
  const days = (Date.parse(targetDate + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / DAY;
  if (!Number.isFinite(days)) return null;
  if (days <= 0) return 0;
  return Math.max(1, Math.ceil(days / 30.44));
}

export interface Progress {
  saved: number;
  remaining: number;
  pct: number; // 0 to 100
  done: boolean;
  /** What to put aside each month to finish on time. Null when there is no date or the goal is done. */
  perMonth: number | null;
  months: number | null;
  overdue: boolean;
}

export function progress(target: number, saved: number, targetDate: string | null, today: string): Progress {
  const t = Math.max(0, target);
  const s = round(Math.max(0, saved));
  const remaining = round(Math.max(0, t - s));
  const done = t > 0 && s >= t;
  const months = monthsLeft(targetDate, today);
  const overdue = !done && months === 0;
  const perMonth = done || months === null ? null : round(remaining / Math.max(1, months));
  return { saved: s, remaining, pct: t > 0 ? Math.min(100, Math.round((s / t) * 100)) : 0, done, perMonth, months, overdue };
}

export interface GoalInput { id?: string; name?: unknown; target?: unknown; targetDate?: unknown; accountId?: unknown }

export function cleanGoal(b: GoalInput): { name: string; target: number; targetDate: string | null; accountId: string | null } | string {
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : '';
  if (!name) return 'A goal needs a name';
  const target = typeof b.target === 'number' ? b.target : Number(String(b.target ?? '').replace(/[$,\s]/g, ''));
  if (!Number.isFinite(target) || target <= 0 || target > 100_000_000) return 'Enter a target amount above $0';
  const d = typeof b.targetDate === 'string' && b.targetDate ? b.targetDate : null;
  if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)))) return 'That date is not valid';
  const accountId = typeof b.accountId === 'string' && b.accountId ? b.accountId.slice(0, 200) : null;
  return { name, target: Math.round(target * 100) / 100, targetDate: d, accountId };
}

