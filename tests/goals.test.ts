import test from 'node:test';
import assert from 'node:assert/strict';
import { allocate, cleanGoal, monthsLeft, progress } from '../src/lib/goals-math.ts';

test('a savings balance fills goals in order and reports the leftover', () => {
  const { alloc, extra } = allocate(2500, [{ id: 'a', target: 2000 }, { id: 'b', target: 1000 }]);
  assert.equal(alloc.get('a'), 2000);
  assert.equal(alloc.get('b'), 500);
  assert.equal(extra, 0);
  assert.equal(allocate(5000, [{ id: 'a', target: 2000 }]).extra, 3000);
});

test('a negative or empty balance gives goals nothing', () => {
  assert.equal(allocate(-50, [{ id: 'a', target: 100 }]).alloc.get('a'), 0);
});

test('months left rounds up and never goes below one while the date is ahead', () => {
  assert.equal(monthsLeft('2026-12-01', '2026-11-17'), 1);
  assert.equal(monthsLeft('2027-05-17', '2026-11-17'), 6);
  assert.equal(monthsLeft('2026-11-01', '2026-11-17'), 0);
  assert.equal(monthsLeft(null, '2026-11-17'), null);
});

test('progress shows the monthly amount needed, and flags done and overdue goals', () => {
  const p = progress(1200, 300, '2027-05-17', '2026-11-17');
  assert.equal(p.remaining, 900);
  assert.equal(p.perMonth, 150);
  assert.equal(p.pct, 25);
  assert.equal(progress(1200, 1200, '2027-05-17', '2026-11-17').done, true);
  assert.equal(progress(1200, 1200, '2027-05-17', '2026-11-17').perMonth, null);
  const late = progress(1000, 400, '2026-10-01', '2026-11-17');
  assert.equal(late.overdue, true);
  assert.equal(late.perMonth, 600);
  assert.equal(progress(500, 100, null, '2026-11-17').perMonth, null);
});

test('goal input is cleaned and bad input is explained', () => {
  assert.deepEqual(cleanGoal({ name: ' Trip ', target: '$2,500', targetDate: '2027-06-01', accountId: 'acc1' }),
    { name: 'Trip', target: 2500, targetDate: '2027-06-01', accountId: 'acc1' });
  assert.equal(typeof cleanGoal({ name: '', target: 5 }), 'string');
  assert.equal(typeof cleanGoal({ name: 'x', target: 0 }), 'string');
  assert.equal(typeof cleanGoal({ name: 'x', target: 5, targetDate: 'soon' }), 'string');
});
