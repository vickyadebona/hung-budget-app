import test from 'node:test';
import assert from 'node:assert/strict';
import { cadenceMonths, cleanLinkText, linkFrequency, linkSubscriptions, parseLinkEmail, resolveDate, sameMerchant, type LinkEvent } from '../src/lib/link.ts';

// Shapes copied from real Link emails (2026), with personal details replaced.
const october = `(Activity icon [https://b.stripecdn.com/x.png])
Your October activity
Here's what you spent last month
Notion Labs Renewed Oct 6
$24.00
Strawberry.me Oct 12
$20.00
Vercel Oct 18
$13.99
Strawberry.me Renewed Oct 19
$180.00
INBOX HEALTH CORP. Oct 20
$90.00
+ 3 more purchases
View details : https://app.link.com/activity
(Subscription icon [https://b.stripecdn.com/y.png])
Your upcoming activity
Review your upcoming November payments
Unassociated Expected Nov 13
$5.00 monthly
+ 2 more payments
View upcoming : https://app.link.com/subscriptions
You can unsubscribe (https://app.link.com/x) at any time.`;

const september = `Your September activity
Here's what you spent last month
LumaBooth Renewed Sep 1
$18.00
Notion Labs Renewed Sep 6
$24.00
Givebutter Renewed Sep 20
$50.00
View details : https://app.link.com/activity
Your upcoming activity
Review your upcoming October payments
Strawberry.me Expected Oct 19
$280.00 every 4 weeks
+ 1 more payment
View upcoming : https://app.link.com/subscriptions`;

const august = `Your August activity
Here's what you spent last month
LumaBooth Renewed Aug 1
$18.00
Notion Labs Renewed Aug 6
$24.00
Sticker Mule Aug 6
$201.75
Scrimba AS Renewed Aug 7
$234.00
+ 3 more purchases
View details : https://app.link.com/activity
Your upcoming activity
Review your September subscriptions
Notion Labs Renews Sep 6
$24 monthly
View upcoming : https://app.link.com/subscriptions`;

const backup = `https://files.stripe.com/files/logo
Notion Labs $24.00
View purchase : https://app.link.com/purchases/cltxn_1
Payment
Example Bank Platinum Credit •••• 1111

Declined
Example Debit Card •••• 2222

Name
Jane Doe

Date
November 6, 2026

Your backup payment was charged. Manage (https://app.link.com/settings/backup_payment_methods)`;

const calAi = `Your subscription is confirmed
Your Cal AI subscription for Cal AI Unlimited has been confirmed. Your card (visa •••• 3333) will be charged $29.99 every year starting on April 11, 2026, unless you cancel.
Manage subscription : https://app.link.com/view?pctx=abc`;

test('cleaning removes links, card digits and the name line', () => {
  const t = cleanLinkText(backup);
  assert.ok(!/https?:/.test(t));
  assert.ok(!/1111|2222|3333/.test(t));
  assert.ok(!/Jane Doe/.test(t));
  assert.ok(!/3333/.test(cleanLinkText(calAi)));
  assert.match(t, /Notion Labs \$24\.00/);
});

test('dates in a summary land in the right year', () => {
  assert.equal(resolveDate('Oct', '6', '2026-11-05T16:14:53Z'), '2026-10-06');
  assert.equal(resolveDate('Jan', '3', '2026-12-28T00:00:00Z'), '2027-01-03');
  assert.equal(resolveDate('Dec', '20', '2027-01-05T00:00:00Z'), '2026-12-20');
});

test('cadence words', () => {
  assert.equal(cadenceMonths('monthly'), 1);
  assert.equal(cadenceMonths('every year'), 12);
  assert.equal(cadenceMonths('every 4 weeks'), 0.92);
  assert.equal(cadenceMonths(null), null);
  assert.equal(linkFrequency(0.92, 'every 4 weeks'), 'every-4-weeks');
  assert.equal(linkFrequency(12, 'every year'), 'yearly');
});

test('a monthly summary gives charges (renewals marked) and what is coming up', () => {
  const ev = parseLinkEmail('Jane, your October transaction summary is ready', october, '2026-11-05T16:14:53Z');
  assert.deepEqual(ev, [
    { kind: 'charge', name: 'Notion Labs', amount: 24, date: '2026-10-06', renewed: true },
    { kind: 'charge', name: 'Strawberry.me', amount: 20, date: '2026-10-12', renewed: false },
    { kind: 'charge', name: 'Vercel', amount: 13.99, date: '2026-10-18', renewed: false },
    { kind: 'charge', name: 'Strawberry.me', amount: 180, date: '2026-10-19', renewed: true },
    { kind: 'charge', name: 'INBOX HEALTH CORP.', amount: 90, date: '2026-10-20', renewed: false },
    { kind: 'upcoming', name: 'Unassociated', amount: 5, date: '2026-11-13', months: 1, cadence: 'monthly' },
  ]);
  const aug = parseLinkEmail('Jane, your August transaction summary is ready', august, '2026-09-05T03:05:11Z');
  assert.deepEqual(aug.at(-1), { kind: 'upcoming', name: 'Notion Labs', amount: 24, date: '2026-09-06', months: 1, cadence: 'monthly' });
});

test('a single purchase and a new subscription', () => {
  assert.deepEqual(parseLinkEmail('Your backup payment was charged', backup, '2026-11-06T04:14:17Z'), [
    { kind: 'charge', name: 'Notion Labs', amount: 24, date: '2026-11-06', renewed: false },
  ]);
  assert.deepEqual(parseLinkEmail('Your Cal AI subscription is confirmed', calAi, '2026-04-08T21:19:40Z'), [
    { kind: 'upcoming', name: 'Cal AI', amount: 29.99, date: '2026-04-11', months: 12, cadence: 'every year' },
  ]);
  assert.deepEqual(parseLinkEmail('New login from iOS (Link App)', 'We noticed a login to your Link account from a new device.', '2026-10-15T00:00:00Z'), []);
});

test('subscriptions are worked out from all the emails together', () => {
  const events: LinkEvent[] = [
    ...parseLinkEmail('Your Cal AI subscription is confirmed', calAi, '2026-04-08T21:19:40Z'),
    ...parseLinkEmail('August transaction summary', august, '2026-09-05T03:05:11Z'),
    ...parseLinkEmail('September transaction summary', september, '2026-10-15T20:36:10Z'),
    ...parseLinkEmail('October transaction summary', october, '2026-11-05T16:14:53Z'),
    ...parseLinkEmail('Your backup payment was charged', backup, '2026-11-06T04:14:17Z'),
  ];
  const subs = linkSubscriptions(events, '2026-11-16');
  const by = Object.fromEntries(subs.map((s) => [s.key, s]));

  assert.deepEqual(Object.keys(by).sort(), ['calai', 'givebutter', 'lumabooth', 'notion', 'scrimba', 'strawberryme', 'unassociated'].filter((k) => k in by).sort());
  assert.equal(by.notion.price, 24);
  assert.equal(by.notion.months, 1);
  assert.equal(by.notion.lastCharged, '2026-11-06');
  assert.equal(by.notion.next, '2026-12-06');

  assert.equal(by.strawberryme.price, 180); // the actual Oct 19 charge, not the $280 Link expected
  assert.equal(by.strawberryme.previousPrice, 280);
  assert.equal(by.strawberryme.next, '2026-11-16');

  assert.equal(by.calai.next, '2027-04-11');
  assert.equal(by.unassociated.name, 'Unnamed charge (Link)');
  assert.equal(by.unassociated.next, '2026-11-13');

  assert.equal(by.lumabooth.months, 1);
  assert.ok(by.lumabooth.next! >= '2026-11-09'); // October's charge was in the "+ 3 more"

  assert.equal(by.scrimba, undefined); // one renewal, cadence unknown, months ago: not shown
  assert.equal(by.vercel, undefined); // never called a renewal
  assert.equal(by.stickermule, undefined);
});

test('the same shop on a bank statement', () => {
  assert.ok(sameMerchant('NOTION LABS', 'Notion Labs'));
  assert.ok(sameMerchant('Notion', 'Notion Labs'));
  assert.ok(sameMerchant('STRAWBERRY ME', 'Strawberry.me'));
  assert.ok(sameMerchant('LUMABOOTH DSLRBOOTH', 'LumaBooth'));
  assert.ok(!sameMerchant('Netflix', 'Notion Labs'));
  assert.ok(!sameMerchant('Spotify', 'Unassociated'));
});
