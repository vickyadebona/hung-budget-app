import test from 'node:test';
import assert from 'node:assert/strict';
import { findRecurring, merchantKey, monthlyCost, type Txn } from '../src/lib/recurring.ts';
import { decrypt, encrypt, keyFromHex } from '../src/lib/secrets.ts';

let n = 0;
const t = (date: string, name: string, amount: number): Txn => ({ id: String(++n), date, name, amount });

test('merchant names with phone numbers and codes collapse together', () => {
  assert.equal(merchantKey({ name: 'APPLE.COM/BILL 866-712-7753 CA' }), merchantKey({ name: 'Apple.com/Bill' }));
  assert.equal(merchantKey({ name: 'NETFLIX.COM *A1B2C3D4' }), 'netflix.com');
});

test('finds a monthly subscription and predicts the next charge', () => {
  const r = findRecurring(
    [t('2026-08-03', 'Netflix', 15.49), t('2026-09-03', 'Netflix', 15.49), t('2026-10-03', 'Netflix', 17.99)],
    '2026-10-20',
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].cadence, 'monthly');
  assert.equal(r[0].nextDate.slice(0, 7), '2026-11');
  assert.equal(r[0].priceChanged, true);
});

test('finds a yearly renewal from only two charges', () => {
  const r = findRecurring([t('2024-11-20', 'Domain Renewal', 21), t('2025-11-20', 'Domain Renewal', 22)], '2026-11-01');
  assert.equal(r.length, 1);
  assert.equal(r[0].cadence, 'yearly');
});

test('ignores habits, refunds and cancelled subscriptions', () => {
  const coffee = [t('2026-10-01', 'Cafe', 4.5), t('2026-10-02', 'Cafe', 11), t('2026-10-09', 'Cafe', 6), t('2026-10-20', 'Cafe', 19)];
  const refunds = [t('2026-08-01', 'Store', -20), t('2026-09-01', 'Store', -20), t('2026-10-01', 'Store', -20)];
  const cancelled = [t('2026-01-05', 'Old Gym', 30), t('2026-02-05', 'Old Gym', 30), t('2026-03-05', 'Old Gym', 30)];
  assert.deepEqual(findRecurring([...coffee, ...refunds, ...cancelled], '2026-10-25'), []);
});

test('monthly cost normalises schedules', () => {
  assert.equal(monthlyCost(120, 'ANNUALLY'), 10);
  assert.equal(monthlyCost(10, 'MONTHLY'), 10);
  assert.ok(Math.abs(monthlyCost(10, 'WEEKLY') - 43.33) < 0.01);
});

test('token encryption round-trips and rejects tampering', () => {
  const key = keyFromHex('ab'.repeat(32));
  const packed = encrypt('access-sandbox-123', key);
  assert.ok(!packed.includes('access-sandbox'));
  assert.equal(decrypt(packed, key), 'access-sandbox-123');
  const parts = packed.split('.');
  parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA');
  assert.throws(() => decrypt(parts.join('.'), key));
  assert.throws(() => keyFromHex('short'));
});
