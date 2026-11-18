import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice, toNumber } from '../src/lib/price-parse.ts';
import { isBlockedHostname, isPrivateAddress, parseWebUrl, storeName } from '../src/lib/url-safety.ts';
import { assess, blackFriday, saleSeason } from '../src/lib/deals.ts';

test('prices are read from different number styles', () => {
  assert.equal(toNumber('$1,299.00'), 1299);
  assert.equal(toNumber('1.299,00'), 1299);
  assert.equal(toNumber('19,99'), 19.99);
  assert.equal(toNumber(0), null);
  assert.equal(toNumber('free'), null);
});

test('a price is found in the product data a shop gives search engines', () => {
  const html = `<html><head><title>Sony a6700 | Store</title>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Sony a6700 Camera",
    "offers":{"@type":"Offer","price":"1399.99","priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script></head></html>`;
  const p = parsePrice(html);
  assert.equal(p.price, 1399.99);
  assert.equal(p.title, 'Sony a6700 Camera');
  assert.equal(p.currency, 'USD');
  assert.equal(p.inStock, true);
});

test('with several offers, the lowest one in stock wins, and graphs of products work', () => {
  const html = `<script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":["Product"],"name":"Chair","offers":[
    {"@type":"Offer","price":80,"availability":"OutOfStock"},{"@type":"Offer","price":120},{"@type":"Offer","price":99}]}]}</script>`;
  assert.equal(parsePrice(html).price, 99);
});

test('meta tags are the fallback, in either attribute order', () => {
  assert.equal(parsePrice('<meta property="og:price:amount" content="45.50"><meta property="og:title" content="Lamp &amp; Shade">').price, 45.5);
  const p = parsePrice('<meta content="12.00" property="product:price:amount">');
  assert.equal(p.price, 12);
});

test('a page with no price, or broken data, gives no price instead of a wrong one', () => {
  assert.equal(parsePrice('<html><body>Hello</body></html>').price, null);
  assert.equal(parsePrice('<script type="application/ld+json">{ nope</script>').price, null);
});

test('links to private or odd places are refused', () => {
  assert.equal(parseWebUrl('ftp://x.com/a'), null);
  assert.equal(parseWebUrl('https://user:pw@shop.com/a'), null);
  assert.equal(parseWebUrl('https://shop.com:8080/a'), null);
  assert.equal(parseWebUrl('shop.com/item')?.href, 'https://shop.com/item');
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1']) assert.equal(isPrivateAddress(ip), true, ip);
  assert.equal(isPrivateAddress('93.184.216.34'), false);
  for (const h of ['localhost', 'printer.local', 'intranet', '127.0.0.1', '[::1]']) assert.equal(isBlockedHostname(h), true, h);
  assert.equal(isBlockedHostname('www.bestbuy.com'), false);
});

test('store names are readable', () => {
  assert.equal(storeName('www.bestbuy.com'), 'Best Buy');
  assert.equal(storeName('shop.example.co.uk'), 'Example');
  assert.equal(storeName('smallshop.com'), 'Smallshop');
});

test('Black Friday falls the day after the fourth Thursday of November', () => {
  assert.equal(blackFriday(2026).blackFriday, '2026-11-27');
  assert.equal(blackFriday(2026).cyberMonday, '2026-11-30');
  assert.equal(blackFriday(2025).blackFriday, '2025-11-28');
  assert.equal(blackFriday(2027).blackFriday, '2027-11-26');
});

test('the sale season is announced ahead, flagged when on, and quiet in between', () => {
  const ahead = saleSeason('2026-11-17');
  assert.equal(ahead?.now, false);
  assert.equal(ahead?.daysAway, 10);
  assert.equal(saleSeason('2026-11-24')?.now, true);
  assert.equal(saleSeason('2026-11-30')?.now, true);
  assert.equal(saleSeason('2026-06-01'), null);
  assert.equal(saleSeason('2026-12-15'), null);
  assert.equal(saleSeason('2026-10-20')?.daysAway, 38);
});

test('price drops, your target price, and lowest-seen are flagged sensibly', () => {
  assert.deepEqual(assess({ current: 90, previous: 100, lowest: 90, readings: 3, target: 95 }), { dropPct: 10, atTarget: true, lowestSeen: true });
  assert.equal(assess({ current: 99, previous: 100, lowest: 99, readings: 2, target: null }).dropPct, null);
  assert.equal(assess({ current: 100, previous: null, lowest: 100, readings: 1, target: null }).lowestSeen, false);
  assert.equal(assess({ current: null, previous: null, lowest: null, readings: 0, target: 50 }).atTarget, false);
});
