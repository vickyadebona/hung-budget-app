import test from 'node:test';
import assert from 'node:assert/strict';
import { deferralPlans, type Deferral } from '../src/lib/cards.ts';

const d = (id: string, amount: number | null, ends: string, kind: Deferral['kind'] = 'deferred'): Deferral => ({ id, kind, label: '', amount, ends });

test('a $9,000 card with $3,000 deferred: its own date and payoff, the rest at the normal rate', () => {
  const r = deferralPlans([d('a', 3000, '2027-05-17')], '2026-11-17', null, 9000);
  assert.equal(r.plans.length, 1);
  assert.deepEqual([r.plans[0].balance, r.plans[0].paymentsLeft, r.plans[0].monthly], [3000, 5, 600]);
  assert.equal(r.rest, 6000);
  assert.equal(r.overBalance, false);
});

test('several deferred amounts are listed soonest first, each with its own plan', () => {
  const r = deferralPlans([d('late', 2000, '2027-11-17'), d('soon', 1000, '2026-12-10')], '2026-11-17', null, 9000);
  assert.deepEqual(r.plans.map((p) => [p.id, p.level]), [['soon', 'urgent'], ['late', 'ok']]);
  assert.equal(r.deferred, 3000);
  assert.equal(r.rest, 6000);
});

test('an amount left blank uses what the bank reports at 0%, or else the part no other entry covers', () => {
  assert.equal(deferralPlans([d('bt', null, '2027-06-01', 'balance-transfer')], '2026-11-17', 2400, 2700).plans[0].balance, 2400);
  const r = deferralPlans([d('fixed', 1000, '2027-06-01'), d('blank', null, '2027-08-01', 'promo')], '2026-11-17', null, 2700);
  assert.equal(r.plans.find((p) => p.id === 'blank')!.balance, 1700);
  assert.equal(r.rest, 0);
});

test('amounts adding up to more than the balance are flagged', () => {
  const r = deferralPlans([d('a', 3000, '2027-05-17'), d('b', 3000, '2027-06-17')], '2026-11-17', null, 5000);
  assert.equal(r.overBalance, true);
  assert.equal(r.rest, 0);
});

test('no entries: nothing deferred', () => {
  assert.deepEqual(deferralPlans([], '2026-11-17', null, 500), { plans: [], deferred: 0, rest: 500, overBalance: false });
});
