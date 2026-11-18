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

/* ---------- interest rates (APRs) ---------- */

export type AprType = 'purchase_apr' | 'balance_transfer_apr' | 'cash_apr' | 'special';
export interface Apr {
  type: AprType;
  pct: number; // 0 means a 0% rate
  balance: number | null; // how much of the balance is at this rate
  interest: number | null; // interest charged at this rate on the last statement
}

const APR_TYPES: AprType[] = ['purchase_apr', 'balance_transfer_apr', 'cash_apr', 'special'];
export const APR_LABEL: Record<AprType, string> = {
  purchase_apr: 'purchases', balance_transfer_apr: 'balance transfer', cash_apr: 'cash advances', special: 'promotional',
};

/** Plaid's aprs list, kept to the four fields that matter, with anything malformed dropped. */
export function cleanAprs(raw: unknown): Apr[] {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return raw
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map((a) => ({ type: a.apr_type as AprType, pct: num(a.apr_percentage), balance: num(a.balance_subject_to_apr), interest: num(a.interest_charge_amount) }))
    .filter((a): a is Apr => APR_TYPES.includes(a.type) && a.pct !== null);
}

/** Rates at 0% that actually hold some balance (a 0% cash rate on an empty balance is not worth showing). */
export function zeroAprs(aprs: Apr[]): Apr[] {
  return aprs.filter((a) => a.pct === 0 && (a.balance === null || a.balance > 0));
}

export function interestCharged(aprs: Apr[]): number {
  return aprs.reduce((n, a) => n + (a.interest ?? 0), 0);
}

/* ---------- 0% offers ending ---------- */

export type PromoLevel = 'ok' | 'soon' | 'urgent' | 'ended';
export const PROMO_SOON_DAYS = 60;
export const PROMO_URGENT_DAYS = 30;

export interface PromoPlan {
  ends: string;
  daysLeft: number;
  level: PromoLevel;
  balance: number; // what needs paying off before the rate goes up
  paymentsLeft: number; // monthly payments still possible before it ends
  monthly: number | null; // per month to clear it in time; null once it has ended or nothing is owed
}

/**
 * How to clear a 0% balance before the offer ends. Uses the balance Plaid reports at 0% when it has one,
 * otherwise the card's whole balance. Rounded up to the dollar so it is never short.
 */
export function promoPlan(ends: string, today: string, zeroBalance: number | null, cardBalance: number | null): PromoPlan {
  const daysLeft = daysUntil(ends, today);
  const balance = Math.max(0, zeroBalance ?? cardBalance ?? 0);
  const paymentsLeft = daysLeft <= 0 ? 0 : Math.max(1, Math.floor(daysLeft / 30.44));
  const level: PromoLevel = daysLeft < 0 ? 'ended' : daysLeft <= PROMO_URGENT_DAYS ? 'urgent' : daysLeft <= PROMO_SOON_DAYS ? 'soon' : 'ok';
  const monthly = daysLeft < 0 || balance <= 0 ? null : Math.ceil(balance / paymentsLeft);
  return { ends, daysLeft, level, balance, paymentsLeft, monthly };
}

/* ---------- several deferred amounts on one card ---------- */

export type DeferralKind = 'balance-transfer' | 'promo' | 'deferred';
export const DEFERRAL_KINDS: DeferralKind[] = ['balance-transfer', 'promo', 'deferred'];
export const DEFERRAL_LABEL: Record<DeferralKind, string> = {
  'balance-transfer': '0% balance transfer',
  promo: '0% purchase offer',
  deferred: 'Deferred interest',
};

export interface Deferral { id: string; kind: DeferralKind; label: string; amount: number | null; ends: string }
export type DeferralPlan = PromoPlan & { id: string; kind: DeferralKind; label: string; amount: number | null };

/**
 * A payoff plan for each deferred part of a card's balance, soonest first. A part with no amount typed in
 * covers what the bank reports at 0%, or else whatever of the card balance the other parts do not.
 * `rest` is the part of the balance on the card's normal rate.
 */
export interface DeferralSummary { plans: DeferralPlan[]; deferred: number; rest: number | null; overBalance: boolean }

export function deferralPlans(list: Deferral[], today: string, zeroBalance: number | null, cardBalance: number | null): DeferralSummary {
  const owed = Math.max(0, cardBalance ?? 0);
  const fixed = list.reduce((n, d) => n + (d.amount ?? 0), 0);
  const plans: DeferralPlan[] = list
    .map((d) => {
      const amount = d.amount ?? zeroBalance ?? Math.max(0, owed - fixed);
      return { ...promoPlan(d.ends, today, amount, null), id: d.id, kind: d.kind, label: d.label, amount: d.amount };
    })
    .sort((a, b) => a.ends.localeCompare(b.ends));
  const deferred = plans.reduce((n, p) => n + p.balance, 0);
  return { plans, deferred, rest: cardBalance == null ? null : Math.max(0, owed - deferred), overBalance: cardBalance != null && deferred > owed + 0.5 };
}
