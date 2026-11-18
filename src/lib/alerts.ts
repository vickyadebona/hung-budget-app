/**
 * Alerts: the things worth hearing about without opening the app. Pure rules here (rows in, alerts out);
 * alert-store.ts gathers the rows and remembers what was dismissed or already emailed.
 */

export type AlertKind = 'card-overdue' | 'card-due' | 'deferral-ending' | 'bill-soon' | 'price-up' | 'large-charge' | 'new-recurring';
export type AlertLevel = 'urgent' | 'soon' | 'info';

export interface Alert {
  id: string; // stable: the same event always gets the same id, so dismissing or emailing it sticks
  kind: AlertKind;
  level: AlertLevel;
  title: string;
  detail: string;
  date: string; // what the alert is about: a due date, an end date or a charge date
  amount: number | null;
  page: 'overview' | 'recurring' | 'transactions' | 'calendar';
}

export interface AlertSettings {
  largeCharge: number; // a single purchase at or above this is flagged
  billDays: number; // bills and card payments due within this many days
  deferralDays: number; // 0%/deferred amounts ending within this many days
}
export const DEFAULT_SETTINGS: AlertSettings = { largeCharge: 300, billDays: 3, deferralDays: 30 };

export interface AlertInput {
  today: string;
  cards: { id: string; name: string; mask: string | null; state: string; details: { next_due: string | null; minimum: number | null } | null; deferrals: { plans: { id: string; ends: string; balance: number; label: string; kind: string; monthly?: number | null }[] } }[];
  recurring: { id: string; label: string; amount: number; nextDate: string | null; priceChanged: boolean; previousAmount: number | null; source: string; cardPayment?: boolean }[]; // card payments are covered by the card's own due date
  charges: { id: string; date: string; name: string; amount: number; who: string | null }[]; // recent posted purchases
  newRecurring: string[]; // recurring ids first seen recently
}

const DAY = 86400000;
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / DAY);
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const when = (days: number) => (days < 0 ? `${-days} day${days === -1 ? '' : 's'} ago` : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`);
const short = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const cardName = (c: { name: string; mask: string | null }) => `${c.name}${c.mask ? ' ··' + c.mask : ''}`;

const ORDER: Record<AlertLevel, number> = { urgent: 0, soon: 1, info: 2 };

export function buildAlerts(input: AlertInput, settings: AlertSettings = DEFAULT_SETTINGS): Alert[] {
  const { today } = input;
  const out: Alert[] = [];

  for (const c of input.cards) {
    const due = c.details?.next_due;
    if (!due) continue;
    const min = c.details?.minimum ?? null;
    if (c.state === 'overdue') {
      out.push({
        id: `card-overdue:${c.id}:${due}`, kind: 'card-overdue', level: 'urgent', page: 'overview', date: due, amount: min,
        title: `${cardName(c)} payment is overdue`,
        detail: `It was due ${short(due)}${min ? `; the minimum is ${money(min)}` : ''}. Paying today limits the late fee.`,
      });
    } else if (c.state === 'due' || c.state === 'due-soon') {
      const days = daysBetween(today, due);
      if (days < 0 || days > settings.billDays) continue;
      out.push({
        id: `card-due:${c.id}:${due}`, kind: 'card-due', level: days <= 1 ? 'urgent' : 'soon', page: 'overview', date: due, amount: min,
        title: `${cardName(c)} payment due ${when(days)}`,
        detail: `${min ? `Minimum ${money(min)}` : 'Payment due'} on ${short(due)}.`,
      });
    }
  }

  for (const c of input.cards) {
    for (const p of c.deferrals.plans) {
      if (p.balance <= 0) continue;
      const days = daysBetween(today, p.ends);
      if (days > settings.deferralDays) continue;
      const what = p.label || (p.kind === 'balance-transfer' ? 'Balance transfer' : p.kind === 'deferred' ? 'Deferred interest' : '0% offer');
      out.push({
        id: `deferral:${p.id}:${p.ends}`, kind: 'deferral-ending', level: days <= 7 ? 'urgent' : 'soon', page: 'overview', date: p.ends, amount: p.balance,
        title: days < 0 ? `${what} on ${cardName(c)} has ended` : `${what} on ${cardName(c)} ends ${when(days)}`,
        detail: days < 0
          ? `${money(p.balance)} was still owing when it ended on ${short(p.ends)}; interest now applies.`
          : `${money(p.balance)} left to pay by ${short(p.ends)}${p.kind === 'deferred' ? ', or interest from the purchase date is added' : ''}.`,
      });
    }
  }

  const recurring = input.recurring.filter((r) => !r.cardPayment);
  for (const r of recurring) {
    if (r.nextDate) {
      const days = daysBetween(today, r.nextDate);
      if (days >= 0 && days <= settings.billDays) {
        out.push({
          id: `bill:${r.id}:${r.nextDate}`, kind: 'bill-soon', level: 'info', page: 'calendar', date: r.nextDate, amount: r.amount,
          title: `${r.label} charges ${when(days)}`,
          detail: `${money(r.amount)} expected on ${short(r.nextDate)}.`,
        });
      }
    }
    const prev = r.previousAmount;
    if (r.priceChanged && prev != null && r.amount - prev >= 0.5) {
      const pct = Math.round(((r.amount - prev) / prev) * 100);
      out.push({
        id: `price-up:${r.id}:${r.amount.toFixed(2)}`, kind: 'price-up', level: 'soon', page: 'recurring', date: today, amount: r.amount,
        title: `${r.label} went up${pct > 0 ? ` ${pct}%` : ''}`,
        detail: `${r.source === 'plaid' ? 'Usually about' : 'Was'} ${money(prev)}, now ${money(r.amount)}: ${money((r.amount - prev) * 12)} more a year if it stays monthly.`,
      });
    }
  }

  const fresh = new Set(input.newRecurring);
  for (const r of recurring) {
    if (!fresh.has(r.id)) continue;
    out.push({
      id: `new:${r.id}`, kind: 'new-recurring', level: 'soon', page: 'recurring', date: today, amount: r.amount,
      title: `New repeating charge: ${r.label}`,
      detail: `${money(r.amount)}${r.nextDate ? `, next on ${short(r.nextDate)}` : ''}. If you didn't sign up for this, check it now.`,
    });
  }

  for (const t of input.charges) {
    if (t.amount < settings.largeCharge) continue;
    out.push({
      id: `large:${t.id}`, kind: 'large-charge', level: 'info', page: 'transactions', date: t.date, amount: t.amount,
      title: `Large purchase: ${t.name}`,
      detail: `${money(t.amount)} on ${short(t.date)}${t.who ? ` (${t.who})` : ''}.`,
    });
  }

  return out.sort((a, b) => ORDER[a.level] - ORDER[b.level] || a.date.localeCompare(b.date));
}

/** A plain-text email of the alerts, for the daily digest. Empty list means no email. */
export function digestEmail(alerts: Alert[], appUrl: string): { subject: string; text: string } | null {
  if (alerts.length === 0) return null;
  const urgent = alerts.filter((a) => a.level === 'urgent').length;
  const subject = urgent
    ? `Budget: ${urgent} thing${urgent > 1 ? 's' : ''} need${urgent > 1 ? '' : 's'} attention today`
    : `Budget: ${alerts.length} update${alerts.length > 1 ? 's' : ''}`;
  const groups: [AlertLevel, string][] = [['urgent', 'Needs attention'], ['soon', 'Coming up'], ['info', 'For your information']];
  const parts = groups
    .map(([lvl, head]) => {
      const list = alerts.filter((a) => a.level === lvl);
      return list.length ? `${head}\n${list.map((a) => `• ${a.title}\n  ${a.detail}`).join('\n')}` : '';
    })
    .filter(Boolean);
  return { subject, text: `${parts.join('\n\n')}\n\nOpen the app: ${appUrl}/#alerts\n` };
}
