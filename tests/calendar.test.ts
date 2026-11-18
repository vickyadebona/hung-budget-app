import test from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, calendarItems, datesBetween, dayTotal, stepFor } from '../src/lib/calendar.ts';

test('months keep their day, and the 31st falls back to the last day of shorter months', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-02-28', 1, 31), '2026-03-31');
  assert.equal(addMonths('2026-11-17', 2), '2027-01-17');
});

test('repeats by schedule within a month', () => {
  assert.deepEqual(datesBetween('2026-11-20', 'weekly', '2026-12-01', '2026-12-31'), ['2026-12-04', '2026-12-11', '2026-12-18', '2026-12-25']);
  assert.deepEqual(datesBetween('2026-11-06', 'MONTHLY', '2027-02-01', '2027-02-28'), ['2027-02-06']);
  assert.deepEqual(datesBetween('2026-11-16', 'every-4-weeks', '2026-12-01', '2026-12-31'), ['2026-12-14']);
  assert.deepEqual(datesBetween('2027-04-11', 'yearly', '2026-12-01', '2026-12-31'), []);
  assert.deepEqual(datesBetween('2026-12-03', 'repeats', '2026-12-01', '2026-12-31'), ['2026-12-03']); // unknown schedule: next date only
  assert.deepEqual(datesBetween('2026-12-03', 'repeats', '2027-01-01', '2027-01-31'), []);
  assert.equal(stepFor('UNKNOWN'), null);
});

test('a month of items: recurring, card due dates, and offers ending; nothing before today', () => {
  const items = calendarItems(
    '2026-11', '2026-11-17',
    [
      { label: 'Netflix', amount: 15.49, frequency: 'monthly', nextDate: '2026-11-20' },
      { label: 'Gym', amount: 49, frequency: 'monthly', nextDate: '2026-12-06' },
      { label: 'Coffee club', amount: 12, frequency: 'weekly', nextDate: '2026-11-10' }, // already past this week's date
    ],
    [{ name: 'Visa', mask: '1177', details: { next_due: '2026-11-21', minimum: 35 }, state: 'due-soon' }],
    [{ name: 'BT Card', mask: '6610', plans: [{ ends: '2026-11-30', balance: 1450, kind: 'balance-transfer', label: '' }] }],
  );
  assert.deepEqual(items.map((i) => [i.date, i.label, i.amount, i.kind]), [
    ['2026-11-17', 'Coffee club', 12, 'recurring'],
    ['2026-11-20', 'Netflix', 15.49, 'recurring'],
    ['2026-11-21', 'Visa ··1177', 35, 'card'],
    ['2026-11-24', 'Coffee club', 12, 'recurring'],
    ['2026-11-30', 'BT Card ··6610', 1450, 'deferral'],
  ]);
  assert.equal(dayTotal(items.filter((i) => i.date === '2026-11-30')), 0); // a reminder, not a charge
});

test('next month: card payments repeat as estimated dates without an amount', () => {
  const items = calendarItems('2026-12', '2026-11-17', [], [{ name: 'Visa', mask: null, details: { next_due: '2026-11-21', minimum: 35 }, state: 'due' }], []);
  assert.deepEqual(items.map((i) => [i.date, i.amount, i.estimated]), [['2026-12-21', null, true]]);
});

test('a paid card has nothing due', () => {
  assert.deepEqual(calendarItems('2026-11', '2026-11-01', [], [{ name: 'Visa', mask: null, details: { next_due: '2026-11-21', minimum: 35 }, state: 'paid' }], []), []);
});
