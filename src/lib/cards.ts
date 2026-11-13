/** Where a credit card stands for its current statement. Pure, so it is easy to test. */

export interface CardLiability {
  next_due: string | null;
  minimum: number | null;
  statement_balance: number | null;
  statement_date: string | null;
  last_payment: number | null;
  last_payment_date: string | null;
  is_overdue: boolean | null;
}

export type CardState = 'overdue' | 'due-soon' | 'due' | 'paid' | 'nothing-due' | 'unknown';

export const DUE_SOON_DAYS = 5;
const DAY = 86400000;

export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(date) - Date.parse(today)) / DAY);
}

export function cardState(c: CardLiability | null, today: string): CardState {
  if (!c) return 'unknown';
  if (c.is_overdue) return 'overdue';
  const owed = (c.statement_balance ?? 0) > 0 && (c.minimum ?? 1) > 0;
  if (!owed) return 'nothing-due';
  // A payment dated on or after the statement counts as paying this statement.
  if (c.last_payment_date && c.statement_date && c.last_payment_date >= c.statement_date && (c.last_payment ?? 0) > 0) return 'paid';
  if (!c.next_due) return 'unknown';
  const days = daysUntil(c.next_due, today);
  if (days < 0) return 'overdue';
  if (days <= DUE_SOON_DAYS) return 'due-soon';
  return 'due';
}

/** A card worth a heads-up: overdue, or due within a few days and not yet paid. */
export function needsAttention(state: CardState): boolean {
  return state === 'overdue' || state === 'due-soon';
}

export function appleFrequency(months: number | null): string {
  if (months === 0.25) return 'weekly';
  if (months === 1) return 'monthly';
  if (months === 3) return 'quarterly';
  if (months === 6) return 'every-6-months';
  if (months === 12) return 'yearly';
  return 'repeats';
}
