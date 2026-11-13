import test from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicates, type AccountLike } from '../src/lib/dedupe.ts';

const acct = (id: string, item: string, extra: Partial<AccountLike> = {}): AccountLike => ({
  id, item_id: item, name: 'Adv Plus Banking', type: 'depository', subtype: 'checking', mask: '1234', current: 4200,
  institution: 'ins_127989', itemCreated: item === 'vicky' ? '2026-11-13T20:00:00Z' : '2026-11-14T09:00:00Z', ...extra,
});

test('a joint checking account linked by both of you is kept once, from the first login', () => {
  const d = findDuplicates([acct('v-chk', 'vicky'), acct('a-chk', 'andrew')]);
  assert.deepEqual([...d], [['a-chk', 'v-chk']]);
});

test('a shared card matches on balance even when the two logins name it differently', () => {
  const d = findDuplicates([
    acct('v-visa', 'vicky', { type: 'credit', subtype: 'credit card', mask: '9876', name: 'Customized Cash Rewards Visa Signature', current: 812.4 }),
    acct('a-visa', 'andrew', { type: 'credit', subtype: 'credit card', mask: '9876', name: 'Customized Cash Rewards', current: 812.4 }),
  ]);
  assert.equal(d.get('a-visa'), 'v-visa');
});

test('your own cards stay separate', () => {
  const d = findDuplicates([
    acct('v-card', 'vicky', { type: 'credit', subtype: 'credit card', mask: '1111', name: 'Travel Rewards', current: 50 }),
    acct('a-card', 'andrew', { type: 'credit', subtype: 'credit card', mask: '2222', name: 'Travel Rewards', current: 50 }), // different last four
    acct('a-card2', 'andrew', { type: 'credit', subtype: 'credit card', mask: '1111', name: 'Premium Rewards', current: 900 }), // same last four, different card
    acct('v-sav', 'vicky', { subtype: 'savings', mask: '1234' }), // same digits as checking but a different type of account
    acct('a-chk-other-bank', 'andrew', { institution: 'ins_3' }),
    acct('nomask', 'andrew', { mask: null }),
  ]);
  assert.equal(d.size, 0);
});

test('two accounts in the same login are never merged', () => {
  assert.equal(findDuplicates([acct('one', 'vicky'), acct('two', 'vicky')]).size, 0);
});
