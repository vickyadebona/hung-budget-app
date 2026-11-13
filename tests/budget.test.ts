import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assign, isIncome, monthRange, guessColumns, noticeFor, parseSheet, perMonth, readTable, rowsFromTable, shiftMonth, suggest, type BudgetTxn, type Line } from '../src/lib/budget-rules.ts';

const line = (id: string, match: string[], extra: Partial<Line> = {}): Line => ({
  id, name: id, group: 'G', direction: 'out', amount: 100, frequency: 'monthly', kind: 'fixed', need: '', note: '', match, ord: 0, ...extra,
});
const txn = (extra: Partial<BudgetTxn>): BudgetTxn => ({
  id: 't', date: '2026-11-05', name: 'X', merchant: null, amount: 10, category: null, detail: null, ...extra,
});
const lines = [
  line('groceries', ['cat:FOOD_AND_DRINK_GROCERIES']),
  line('eating-out', ['cat:FOOD_AND_DRINK']),
  line('spotify', ['m:spotify']),
  line('tithe', ['cat:GOVERNMENT_AND_NON_PROFIT_DONATIONS']),
  line('pay', [], { direction: 'in' }),
];
const none = new Map<string, string | null>();

test('the most specific bank category wins', () => {
  assert.equal(assign(txn({ category: 'FOOD_AND_DRINK', detail: 'FOOD_AND_DRINK_GROCERIES' }), lines, none), 'groceries');
  assert.equal(assign(txn({ category: 'FOOD_AND_DRINK', detail: 'FOOD_AND_DRINK_COFFEE' }), lines, none), 'eating-out');
});

test('merchant rules beat category rules, and your own choice beats both', () => {
  const t = txn({ name: 'SPOTIFY USA 877-778-1161 NY', category: 'FOOD_AND_DRINK', detail: 'FOOD_AND_DRINK_COFFEE' });
  assert.equal(assign(t, lines, none), 'spotify');
  assert.equal(assign(t, lines, new Map([['t', 'tithe']])), 'tithe');
  assert.equal(assign(t, lines, new Map([['t', null]])), null);
  assert.equal(assign(t, lines, new Map([['t', 'deleted-line']])), 'spotify');
});

test('transfers, card payments and paychecks are not spending', () => {
  assert.equal(assign(txn({ category: 'TRANSFER_OUT', detail: 'TRANSFER_OUT_SAVINGS' }), lines, none), null);
  assert.equal(assign(txn({ category: 'LOAN_PAYMENTS', detail: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', amount: 900 }), lines, none), null);
  const pay = txn({ category: 'INCOME', detail: 'INCOME_WAGES', amount: -2900 });
  assert.equal(assign(pay, lines, none), null);
  assert.equal(isIncome(pay), true);
});

test('unknown spending is left for you to sort; unknown refunds are ignored', () => {
  assert.equal(assign(txn({ name: 'Mystery Shop', category: 'GENERAL_MERCHANDISE' }), lines, none), 'unassigned');
  assert.equal(assign(txn({ name: 'Mystery Shop', amount: -10 }), lines, none), null);
  // a refund at a known place still reduces that line
  assert.equal(assign(txn({ amount: -5, category: 'FOOD_AND_DRINK', detail: 'FOOD_AND_DRINK_GROCERIES' }), lines, none), 'groceries');
});

test('schedules convert to a monthly figure', () => {
  assert.equal(perMonth({ amount: 2900, frequency: 'twice-monthly' }), 5800);
  assert.equal(perMonth({ amount: 120, frequency: 'yearly' }), 10);
  assert.ok(Math.abs(perMonth({ amount: 100, frequency: 'biweekly' }) - 216.67) < 0.01);
});

test('month helpers handle year ends', () => {
  assert.deepEqual(monthRange('2026-12'), { from: '2026-12-01', to: '2027-01-01' });
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
});

test('the starter budget file is well formed', { skip: !fs.existsSync('seed/budget.json') }, () => {
  const { lines: seed } = JSON.parse(fs.readFileSync('seed/budget.json', 'utf8'));
  const freq = ['weekly', 'biweekly', 'twice-monthly', 'monthly', 'yearly'];
  for (const l of seed) {
    assert.ok(l.name && l.group, 'name and group');
    assert.ok(typeof l.amount === 'number' && l.amount >= 0, l.name);
    assert.ok(freq.includes(l.frequency), l.name);
  }
  assert.equal(new Set(seed.map((l: any) => l.name)).size, seed.length, 'no duplicate names');
});

test('notices: over budget, or $50 or less left', () => {
  const groceries = line('g', [], { name: 'Groceries', amount: 800 });
  assert.equal(noticeFor(groceries, 700), null);
  assert.deepEqual(noticeFor(groceries, 760), { lineId: 'g', name: 'Groceries', level: 'low', left: 40, limit: 800 });
  assert.equal(noticeFor(groceries, 800)?.level, 'low');
  assert.equal(noticeFor(groceries, 812.5)?.level, 'over');
  assert.equal(noticeFor(groceries, 812.5)?.left, -12.5);
  // small budgets do not nag until half is used
  assert.equal(noticeFor(line('s', [], { amount: 40 }), 5), null);
  assert.equal(noticeFor(line('s', [], { amount: 40 }), 25)?.level, 'low');
  // a yearly bill is measured against the yearly amount
  assert.equal(noticeFor(line('y', [], { amount: 139, frequency: 'yearly' }), 139)?.level, 'low');
  assert.equal(noticeFor(line('y', [], { amount: 600, frequency: 'yearly' }), 300), null);
  assert.equal(noticeFor(line('i', [], { direction: 'in' }), 999), null);
});

test('suggestions pay fixed bills first, then scale flexible lines to fit', () => {
  const plan = [
    line('rent', [], { amount: 3000, kind: 'fixed' }),
    line('food', [], { amount: 800, kind: 'variable' }),
    line('fun', [], { amount: 200, kind: 'variable' }),
  ];
  const tight = suggest(plan, 3500);
  assert.equal(tight.available, 500);
  assert.deepEqual(tight.lines.map((l) => l.suggested), [400, 100]);
  const roomy = suggest(plan, 6000);
  assert.deepEqual(roomy.lines.map((l) => l.suggested), [800, 200]);
  assert.equal(roomy.available - roomy.flexible, 2000);
  const short = suggest(plan, 2500);
  assert.equal(short.shortfall, 500);
  assert.deepEqual(short.lines.map((l) => l.suggested), [0, 0]);
});

test('reads rows pasted from a spreadsheet, with or without headers', () => {
  const pasted = 'Category\t$$$\tFixed / Variable\tFrequency\nGroceries\t$800\tVariable\tMonthly\nAmazon Prime\t$139.00\tFixed\tAnnually\nVacation Fund\t\t\t\n';
  assert.deepEqual(parseSheet(pasted), [
    { name: 'Groceries', amount: 800, frequency: 'monthly', kind: 'variable' },
    { name: 'Amazon Prime', amount: 139, frequency: 'yearly', kind: 'fixed' },
  ]);
  assert.deepEqual(parseSheet('"Rent, apartment","3,017"\nGas,350,monthly'), [
    { name: 'Rent, apartment', amount: 3017 },
    { name: 'Gas', amount: 350, frequency: 'monthly' },
  ]);
  assert.deepEqual(parseSheet('just some words'), []);
});

test('finds the columns in a messy export: title rows, extra columns, odd header names', () => {
  const csv = [
    'Hung Family Budget,,,,',
    ',,,,',
    'Notes,Expense,Who,Monthly Amount,How often',
    'due the 1st,Rent,Both,"$3,017.00",Monthly',
    ',Groceries,Both,$800/mo,monthly',
    ',"Dinner, dates",Both,300,Monthly',
    ',Prime,Vicky,139,Annually',
    ',Vacation,Both,,',
    'TOTAL,,,,',
  ].join('\r\n');
  const table = readTable(csv);
  const m = guessColumns(table);
  assert.deepEqual([m.header, m.name, m.amount, m.frequency], [1, 1, 3, 4]); // the blank row is dropped
  assert.deepEqual(rowsFromTable(table, m), [
    { name: 'Rent', amount: 3017, frequency: 'monthly' },
    { name: 'Groceries', amount: 800, frequency: 'monthly' },
    { name: 'Dinner, dates', amount: 300, frequency: 'monthly' },
    { name: 'Prime', amount: 139, frequency: 'yearly' },
  ]);
});

test('with no recognisable titles, guesses from the contents, and you can override the guess', () => {
  const table = readTable('Thing,Owner,How much\nRent,Both,3017\nGas,Andrew,350\nSpotify,Andrew,18');
  const m = guessColumns(table);
  assert.equal(m.amount, 2);
  assert.equal(rowsFromTable(table, { ...m, name: 0 }).length, 3);
  assert.deepEqual(rowsFromTable(table, { ...m, name: 0, group: 1 })[1], { name: 'Gas', amount: 350, group: 'Andrew' });
  assert.deepEqual(rowsFromTable(table, { ...m, name: -1 }), []);
});

test('reads quoted cells with line breaks, and semicolon files', () => {
  assert.deepEqual(readTable('a,"line one\nline two",c\n\n1,2,3'), [['a', 'line one\nline two', 'c'], ['1', '2', '3']]);
  assert.deepEqual(readTable('Name;Amount\nRent;3017'), [['Name', 'Amount'], ['Rent', '3017']]);
});
