/**
 * Reads Apple receipt emails ("Your receipt from Apple.") into subscription rows. Pure text in, rows out.
 * Works on the text the Gmail script sends (HTML with tags stripped) and on Gmail's own plain-text version,
 * by flattening everything to one line and splitting it at each price.
 */

export interface AppleItem {
  key: string; // stable id for the subscription: lower-case name, letters and digits only
  name: string;
  price: number;
  months: number | null; // 0.25 weekly, 1 monthly, 3, 6, 12; null when it cannot be told
  renews: string | null; // YYYY-MM-DD
  cadence: string | null; // what the receipt said: "Monthly", "Yearly"...
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const DATE = '([A-Z][a-z]{2,8}\\.? \\d{1,2}, \\d{4})';

export function parseDate(text: string): string | null {
  const m = text.match(/([A-Za-z]{3,9})\.? (\d{1,2}), (\d{4})/);
  if (!m) return null;
  const mon = MONTHS[m[1].toLowerCase()];
  if (!mon) return null;
  return `${m[3]}-${String(mon).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

const CADENCE: [RegExp, number][] = [
  [/^(weekly|1 week)$/i, 0.25],
  [/^(monthly|1 month)$/i, 1],
  [/^(quarterly|3 months)$/i, 3],
  [/^(semi-?annual(ly)?|6 months)$/i, 6],
  [/^(yearly|annual(ly)?|1 year|12 months)$/i, 12],
];

function cadenceMonths(label: string): number | null {
  for (const [re, m] of CADENCE) if (re.test(label.trim())) return m;
  return null;
}

/** When the receipt does not say the cadence, the gap between the charge and the renewal date does. */
export function inferMonths(chargedOn: string, renews: string): number | null {
  const days = (Date.parse(renews) - Date.parse(chargedOn)) / 86400000;
  if (!Number.isFinite(days) || days <= 0) return null;
  if (days <= 10) return 0.25;
  if (days <= 45) return 1;
  if (days <= 100) return 3;
  if (days <= 200) return 6;
  if (days <= 400) return 12;
  return null;
}

export function monthlyApple(price: number, months: number | null): number {
  return months ? price / months : price;
}

export const appleKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Everything after these is the billing address and payment card: never read past them. */
const STOP = /Billing and Payment|Subtotal|\bTOTAL\b|Payment Information/i;

function flatten(text: string): string {
  let t = text
    .replace(/\]\([^)]*\)/g, ' ') // markdown links: keep the words, drop the address
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\s@]+@[^\s@]+\.[a-z]{2,}/gi, ' ') // email addresses
    .replace(/[|#*_[\]>`]+/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
  const stop = t.search(STOP);
  if (stop > 0) t = t.slice(0, stop);
  return t.trim();
}

// The header (date, order number, Apple Card offer) sits in front of the first item; cut it off.
const HEADER = new RegExp(
  [
    'Apple Account:?', 'APPLE ID', 'Apply and use in minutes\\.?\\s*2?', 'Document:?\\s*(?:No\\.?)?\\s*\\d+', 'DOCUMENT NO\\.?\\s*\\d+',
    'Order ID:?\\s*[A-Z0-9]+', 'Receipt(?: & Renewal Notice)?\\s+' + DATE, 'Write a Review', 'Report a Problem', 'Renewal Price',
  ].join('|'),
  'g',
);

function cleanName(label: string): string {
  let n = label
    .replace(new RegExp('(Renews|Renewal Date:?|Next Billing Date:?|Next Contract Renewal Date:?|Expires( on)?:?|Billed on:?)\\s*' + DATE, 'gi'), ' ')
    .replace(/Agreement\/Policy number:?\s*\S+/gi, ' ')
    .replace(/\((weekly|monthly|quarterly|yearly|annual(ly)?|semi-?annual(ly)?|\d+ (weeks?|months?|years?))\)/gi, ' ')
    .replace(/\b(Free Trial|Trial)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // "iCloud iCloud+ with 2 TB": the app name is repeated at the start of the plan name.
  const words = n.split(' ');
  if (words.length > 1 && words[1].toLowerCase().startsWith(words[0].toLowerCase())) n = words.slice(1).join(' ');
  return n.slice(0, 100);
}

/** Subscription lines in one receipt. One-off purchases (no renewal date or cadence) are left out. */
export function parseAppleReceipt(text: string, chargedOn: string): AppleItem[] {
  const flat = flatten(text);
  const parts = flat.split(/\$\s?(\d[\d,]*\.\d{2})/);
  const items: AppleItem[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    let label = parts[i - 1];
    let last = -1;
    for (const m of label.matchAll(HEADER)) last = (m.index ?? 0) + m[0].length;
    if (last >= 0) label = label.slice(last);
    label = label.trim();
    if (!label) continue;

    const renewMatch = label.match(new RegExp('(?:Renews|Renewal Date:?|Next Billing Date:?)\\s*' + DATE, 'i'));
    const cadenceMatch = label.match(/\((weekly|monthly|quarterly|yearly|annual(?:ly)?|semi-?annual(?:ly)?|\d+ (?:weeks?|months?|years?))\)/i);
    if (!renewMatch && !cadenceMatch) continue; // a one-off purchase

    const name = cleanName(label);
    if (!name || name.length < 2) continue;
    const renews = renewMatch ? parseDate(renewMatch[1]) : null;
    let months = cadenceMatch ? cadenceMonths(cadenceMatch[1]) : null;
    if (months === null && renews) months = inferMonths(chargedOn, renews);
    items.push({
      key: appleKey(name),
      name,
      price: Number(parts[i].replace(/,/g, '')),
      months,
      renews,
      cadence: cadenceMatch ? cadenceMatch[1] : null,
    });
  }
  return items;
}
