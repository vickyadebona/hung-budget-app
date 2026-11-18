import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAlerts, digestEmail, type AlertInput } from '../src/lib/alerts.ts';

const base = (over: Partial<AlertInput> = {}): AlertInput => ({ today: '2026-11-18', cards: [], recurring: [], charges: [], newRecurring: [], ...over });
const card = (state: string, next_due: string, plans: AlertInput['cards'][0]['deferrals']['plans'] = []) =>
  ({ id: 'c1', name: 'Visa', mask: '1177', state, details: { next_due, minimum: 35 }, deferrals: { plans } });

test('card payments: overdue is urgent, due tomorrow is urgent, due in 3 days is coming up, later is quiet, paid is quiet', () => {
  assert.deepEqual(buildAlerts(base({ cards: [card('overdue', '2026-11-15')] })).map((a) => [a.kind, a.level]), [['card-overdue', 'urgent']]);
  assert.equal(buildAlerts(base({ cards: [card('due-soon', '2026-11-19')] }))[0].level, 'urgent');
  assert.equal(buildAlerts(base({ cards: [card('due-soon', '2026-11-21')] }))[0].title, 'Visa ··1177 payment due in 3 days');
  assert.equal(buildAlerts(base({ cards: [card('due', '2026-11-28')] })).length, 0);
  assert.equal(buildAlerts(base({ cards: [card('paid', '2026-11-19')] })).length, 0);
});

test('0% and deferred amounts ending within 30 days, urgent in the last week; paid-off ones are quiet', () => {
  const plan = (id: string, ends: string, balance: number, kind = 'balance-transfer') => ({ id, ends, balance, kind, label: '' });
  const out = buildAlerts(base({ cards: [card('nothing-due', '2026-12-10', [plan('a', '2026-11-22', 1450), plan('b', '2026-12-10', 600, 'deferred'), plan('c', '2027-03-01', 900), plan('d', '2026-11-20', 0)])] }));
  assert.deepEqual(out.map((a) => [a.id, a.level]), [['deferral:a:2026-11-22', 'urgent'], ['deferral:b:2026-12-10', 'soon']]);
  assert.match(out[1].detail, /interest from the purchase date/);
});

test('price increases (not decreases), bills charging soon, and new repeating charges', () => {
  const r = (id: string, amount: number, previousAmount: number | null, nextDate: string | null = null) =>
    ({ id, label: id, amount, previousAmount, priceChanged: previousAmount !== null, nextDate, source: 'apple' });
  const out = buildAlerts(base({ recurring: [r('Netflix', 17.99, 15.49), r('Gym', 39, 49), r('Phone', 80, null, '2026-11-20'), r('NewApp', 9.99, null)], newRecurring: ['NewApp'] }));
  assert.deepEqual(out.map((a) => a.kind).sort(), ['bill-soon', 'new-recurring', 'price-up']);
  const up = out.find((a) => a.kind === 'price-up')!;
  assert.equal(up.title, 'Netflix went up 16%');
  assert.match(up.detail, /Was \$15\.49, now \$17\.99: \$30\.00 more a year/);
  assert.equal(up.id, 'price-up:Netflix:17.99'); // a later increase gets a new id, so it is flagged again
});

test('large purchases use the threshold', () => {
  const charges = [{ id: 't1', date: '2026-11-16', name: 'Costco', amount: 412.5, who: 'Hung' }, { id: 't2', date: '2026-11-17', name: 'Cafe', amount: 6 }].map((c) => ({ who: null, ...c }));
  assert.deepEqual(buildAlerts(base({ charges })).map((a) => a.title), ['Large purchase: Costco']);
  assert.equal(buildAlerts(base({ charges }), { largeCharge: 500, billDays: 3, deferralDays: 30 }).length, 0);
  assert.match(buildAlerts(base({ charges }))[0].detail, /\(Hung\)/);
});

test('the email groups by urgency and is skipped when there is nothing', () => {
  assert.equal(digestEmail([], 'https://x.app'), null);
  const mail = digestEmail(buildAlerts(base({ cards: [card('overdue', '2026-11-15')], charges: [{ id: 't', date: '2026-11-16', name: 'TV', amount: 900, who: null }] })), 'https://x.app')!;
  assert.equal(mail.subject, 'Budget: 1 thing needs attention today');
  assert.match(mail.text, /^Needs attention\n• Visa ··1177 payment is overdue/);
  assert.match(mail.text, /For your information\n• Large purchase: TV/);
  assert.match(mail.text, /https:\/\/x\.app\/#alerts/);
});
