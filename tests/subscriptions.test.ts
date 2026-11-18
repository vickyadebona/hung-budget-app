import test from 'node:test';
import assert from 'node:assert/strict';
import { judge, looksCancelled, markKey, switchedToYearly, type Mark, type Row } from '../src/lib/subscriptions.ts';

const row = (label: string, extra: Partial<Row> = {}): Row => ({
  id: 'r-' + label, label, frequency: 'MONTHLY', amount: 15, monthly: 15, lastDate: '2026-11-01', nextDate: '2026-12-01', source: 'plaid', ...extra,
});
const today = '2026-11-13';

test('a big charge after small monthly ones is read as a switch to yearly', () => {
  const charges = [{ date: '2026-07-03', amount: 15.99 }, { date: '2026-08-03', amount: 15.99 }, { date: '2026-09-03', amount: 15.99 }, { date: '2026-10-03', amount: 159.99 }];
  assert.deepEqual(switchedToYearly(charges), { date: '2026-10-03', amount: 159.99 });
  assert.equal(switchedToYearly(charges.slice(0, 3)), null); // all the same size
  assert.equal(switchedToYearly([{ date: '2026-10-01', amount: 15 }, { date: '2026-10-02', amount: 160 }]), null); // too little history
  const [j] = judge([row('Audible', { lastDate: '2026-09-03' })], new Map(), new Map([['audible', charges]]), today);
  assert.deepEqual([j.frequency, j.amount, j.nextDate, j.switchedToYearly, j.status], ['yearly', 159.99, '2027-10-03', true, 'active']);
  assert.ok(Math.abs(j.monthly - 13.33) < 0.01);
});

test('no charge well past the due date reads as possibly cancelled', () => {
  assert.equal(looksCancelled(row('Wildgrain', { lastDate: '2026-10-05' }), today), true); // monthly, 39 days ago
  assert.equal(looksCancelled(row('Netflix', { lastDate: '2026-10-10' }), today), false); // 34 days: still in grace
  assert.equal(looksCancelled(row('Factor', { frequency: 'WEEKLY', lastDate: '2026-10-28' }), today), true);
  assert.equal(looksCancelled(row('Prime', { frequency: 'yearly', lastDate: '2026-03-01' }), today), false);
  assert.equal(looksCancelled(row('iCloud', { source: 'apple', lastDate: '2026-01-01' }), today), false);
});

test('your marks win: cancelled, still active, not a subscription, yearly, monthly', () => {
  const rows = [
    row('GEICO', { lastDate: '2026-11-01' }),
    row('Wildgrain', { lastDate: '2026-10-05' }),
    row('Gym', { lastDate: '2026-10-05' }),
    row('Venmo transfer'),
    row('Claude', { amount: 20, monthly: 20 }),
  ];
  const marks = new Map<string, Mark>([
    [markKey(rows[0]), 'cancelled'], [markKey(rows[2]), 'active'], [markKey(rows[3]), 'not-subscription'], [markKey(rows[4]), 'yearly'],
  ]);
  const charges = new Map([['claude', [{ date: '2026-11-02', amount: 200 }]]]);
  const out = judge(rows, marks, charges, today);
  assert.deepEqual(out.map((r) => r.status), ['cancelled', 'possibly-cancelled', 'active', 'hidden', 'active']);
  assert.deepEqual([out[4].frequency, out[4].amount, out[4].nextDate], ['yearly', 200, '2027-11-02']);
  const [m] = judge([row('Spotify', { frequency: 'ANNUALLY', amount: 18, monthly: 1.5 })], new Map([['m:spotify', 'monthly' as Mark]]), new Map(), today);
  assert.deepEqual([m.frequency, m.monthly], ['monthly', 18]);
});

test('marks are saved per merchant, so they survive Plaid re-detecting the charge', () => {
  assert.equal(markKey(row('GEICO 800-841-3000 DC')), markKey(row('Geico')));
  assert.equal(markKey({ id: 'apple:v@x.com:withings', label: 'Withings+', source: 'apple' }), 'apple:v@x.com:withings');
});
