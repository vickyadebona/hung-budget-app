import test from 'node:test';
import assert from 'node:assert/strict';
import { inferMonths, monthlyApple, parseAppleReceipt, parseDate } from '../src/lib/apple.ts';

// Shapes copied from real Apple receipts (Nov 2026), with personal details replaced.
const applecareGmail = `# Receipt & Renewal Notice

November 13, 2026

Order ID:

MV6N4FYB7G

Document:

808218782041

Apple Account:

someone@example.com

| | AppleCare One Individual (Monthly) Agreement/Policy number: 9106831760 Next Billing Date: December 13, 2026 Next Contract Renewal Date: December 13, 2026 | $19.99 |

| | AppleCare One Add-on Coverage for 1 additional device Next Billing Date: December 13, 2026 Next Contract Renewal Date: December 13, 2026 | $5.99 |

## Billing and Payment

Jane Doe

1 Example St

Subtotal

$25.98`;

const icloudGmail = `# Receipt

November 10, 2026

Order ID:

MV6N403JL4

Document:

708217311082

Apple Account:

someone@example.com

Save 3% on all your Apple purchases with Apple Card.1 [Apply and use in minutes.2](https://www.apple.com/apple-card?rid=287-cid%3Dapy-120-100002)

| | iCloud iCloud+ with 2 TB (Monthly) Renews December 8, 2026 | $9.99 |

## Billing and Payment

Subtotal

$9.99`;

// What the Gmail script sends: HTML with the tags turned into spaces.
const icloudScript = 'Receipt November 10, 2026 Order ID: MV6N403JL4 Document: 708217311082 Apple Account: Save 3% on all your Apple purchases with Apple Card. 1 Apply and use in minutes. 2 iCloud iCloud+ with 2 TB (Monthly) Renews December 8, 2026 $9.99';

const oneOff = 'Your Apple Account was used to purchase Focus Friend Lifetime Pro Offer. Receipt Save 3% on all your Apple purchases with Apple Card. 1 Apply and use in minutes 2 Focus Friend Lifetime Pro Offer In-App Purchase $29.99 Billing and Payment Subtotal $29.99';

test('reads a two-item AppleCare renewal and infers the cadence it does not state', () => {
  const items = parseAppleReceipt(applecareGmail, '2026-11-13');
  assert.deepEqual(items.map((i) => [i.name, i.price, i.months, i.renews]), [
    ['AppleCare One Individual', 19.99, 1, '2026-12-13'],
    ['AppleCare One Add-on Coverage for 1 additional device', 5.99, 1, '2026-12-13'],
  ]);
});

test('reads iCloud from both Gmail text and the script text, dropping the repeated app name', () => {
  for (const text of [icloudGmail, icloudScript]) {
    const [item, ...rest] = parseAppleReceipt(text, '2026-11-10');
    assert.equal(rest.length, 0);
    assert.deepEqual([item.name, item.price, item.months, item.renews, item.key], ['iCloud+ with 2 TB', 9.99, 1, '2026-12-08', 'icloudwith2tb']);
  }
});

test('skips one-off purchases, and never reads past the billing section', () => {
  assert.deepEqual(parseAppleReceipt(oneOff, '2026-10-24'), []);
  assert.deepEqual(parseAppleReceipt('Some App (Monthly) Renews December 1, 2026 Billing and Payment $5.00', '2026-11-01'), []);
});

test('yearly and weekly plans, and free trials', () => {
  const [y] = parseAppleReceipt('Receipt November 1, 2026 Yuka Premium (Yearly) Renews November 1, 2027 $9.99', '2026-11-01');
  assert.deepEqual([y.name, y.months, y.renews], ['Yuka Premium', 12, '2027-11-01']);
  assert.ok(Math.abs(monthlyApple(y.price, y.months) - 0.8325) < 0.001);
  const [t] = parseAppleReceipt('Receipt November 1, 2026 Calm Annual Free Trial Renews November 8, 2026 $0.00', '2026-11-01');
  assert.deepEqual([t.name, t.price, t.months], ['Calm Annual', 0, 0.25]);
});

test('date helpers', () => {
  assert.equal(parseDate('Renews December 8, 2026'), '2026-12-08');
  assert.equal(parseDate('Sept. 3, 2026'), '2026-09-03');
  assert.equal(parseDate('nothing here'), null);
  assert.equal(inferMonths('2026-11-01', '2027-11-01'), 12);
  assert.equal(inferMonths('2026-11-01', '2026-10-01'), null);
});

test('card status: paid, due soon, overdue, nothing owed', async () => {
  const { cardState } = await import('../src/lib/cards.ts');
  const base = { next_due: '2026-11-20', minimum: 35, statement_balance: 900, statement_date: '2026-10-25', last_payment: 500, last_payment_date: '2026-10-20', is_overdue: false };
  assert.equal(cardState(base, '2026-11-01'), 'due');
  assert.equal(cardState(base, '2026-11-16'), 'due-soon');
  assert.equal(cardState(base, '2026-11-21'), 'overdue');
  assert.equal(cardState({ ...base, last_payment_date: '2026-11-02' }, '2026-11-16'), 'paid'); // paid after the statement
  assert.equal(cardState({ ...base, statement_balance: 0 }, '2026-11-16'), 'nothing-due');
  assert.equal(cardState({ ...base, is_overdue: true }, '2026-11-01'), 'overdue');
  assert.equal(cardState(null, '2026-11-01'), 'unknown');
});

test('APRs: keeps valid rates, spots 0% balances, totals interest', async () => {
  const { cleanAprs, zeroAprs, interestCharged } = await import('../src/lib/cards.ts');
  const aprs = cleanAprs([
    { apr_percentage: 24.99, apr_type: 'purchase_apr', balance_subject_to_apr: 300, interest_charge_amount: 6.2 },
    { apr_percentage: 0, apr_type: 'balance_transfer_apr', balance_subject_to_apr: 2400, interest_charge_amount: 0 },
    { apr_percentage: 0, apr_type: 'cash_apr', balance_subject_to_apr: 0, interest_charge_amount: 0 }, // 0% but nothing at that rate
    { apr_percentage: 'x', apr_type: 'special' }, // malformed
    { apr_percentage: 5, apr_type: 'mystery' },
  ]);
  assert.equal(aprs.length, 3);
  assert.deepEqual(zeroAprs(aprs).map((a) => [a.type, a.balance]), [['balance_transfer_apr', 2400]]);
  assert.equal(interestCharged(aprs), 6.2);
  assert.deepEqual(cleanAprs(null), []);
});

test('0% offer plan: monthly amount to clear it, and how urgent it is', async () => {
  const { promoPlan } = await import('../src/lib/cards.ts');
  const far = promoPlan('2027-11-13', '2026-11-13', 2400, 2700);
  assert.deepEqual([far.level, far.paymentsLeft, far.monthly, far.balance], ['ok', 11, 219, 2400]); // uses the 0% balance, not the whole card
  assert.equal(promoPlan('2027-01-10', '2026-11-13', 1000, null).level, 'soon');
  const urgent = promoPlan('2026-12-01', '2026-11-13', 1000, null);
  assert.deepEqual([urgent.level, urgent.paymentsLeft, urgent.monthly], ['urgent', 1, 1000]);
  const ended = promoPlan('2026-11-01', '2026-11-13', 1000, null);
  assert.deepEqual([ended.level, ended.monthly], ['ended', null]);
  assert.equal(promoPlan('2027-06-01', '2026-11-13', null, 500).balance, 500); // falls back to the card balance
  assert.equal(promoPlan('2027-06-01', '2026-11-13', null, -20).monthly, null); // nothing owed
});
