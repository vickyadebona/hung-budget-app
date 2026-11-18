/** Finds a product's price in a page's HTML. Most shops describe it for search engines, and that is what we read. */

export interface Parsed {
  price: number | null;
  title: string | null;
  inStock: boolean | null;
  currency: string | null;
}

export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 && v < 1e7 ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/[^0-9.,]/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lastComma >= 0) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n < 1e7 ? Math.round(n * 100) / 100 : null;
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

function metaTags(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const val = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (key && val != null && !out.has(key.toLowerCase())) out.set(key.toLowerCase(), val);
  }
  return out;
}

type Offer = { price: number; currency: string | null; inStock: boolean };

function offersOf(node: any): Offer[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(offersOf);
  const list: Offer[] = [];
  const spec = node.priceSpecification;
  const price = toNumber(node.price) ?? toNumber(node.lowPrice) ?? toNumber(Array.isArray(spec) ? spec[0]?.price : spec?.price);
  if (price != null) {
    const cur = node.priceCurrency ?? (Array.isArray(spec) ? spec[0]?.priceCurrency : spec?.priceCurrency) ?? null;
    list.push({ price, currency: typeof cur === 'string' ? cur.toUpperCase() : null, inStock: !/OutOfStock|SoldOut|Discontinued/i.test(String(node.availability ?? '')) });
  }
  if (node.offers) list.push(...offersOf(node.offers));
  return list;
}

function products(node: any, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((n) => products(n, out)); return out; }
  const t = node['@type'];
  const types = Array.isArray(t) ? t : [t];
  if (types.some((x) => typeof x === 'string' && /^(Product|ProductGroup|IndividualProduct)$/i.test(x))) {
    out.push(node);
    if (node.hasVariant) products(node.hasVariant, out);
  }
  if (node['@graph']) products(node['@graph'], out);
  return out;
}

export function parsePrice(html: string): Parsed {
  const meta = metaTags(html);
  const title = decode(meta.get('og:title') ?? /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '') || null;
  let offers: Offer[] = [];
  let name: string | null = null;

  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim().replace(/^<!--|-->$/g, ''));
      for (const p of products(data)) {
        const found = offersOf(p.offers);
        if (found.length && !name && typeof p.name === 'string') name = decode(p.name);
        offers.push(...found);
      }
    } catch { /* a broken block is skipped */ }
  }

  if (offers.length === 0) {
    const amount = toNumber(meta.get('og:price:amount') ?? meta.get('product:price:amount') ?? meta.get('product:sale_price:amount') ?? meta.get('price'));
    const cur = meta.get('og:price:currency') ?? meta.get('product:price:currency') ?? meta.get('pricecurrency');
    if (amount != null) offers = [{ price: amount, currency: cur ? cur.toUpperCase() : null, inStock: true }];
  }

  if (offers.length === 0) return { price: null, title: name ?? title, inStock: null, currency: null };
  // A page can list several sellers or sizes. Take the lowest price among those in stock.
  const pool = offers.filter((o) => o.inStock);
  const use = pool.length ? pool : offers;
  const best = use.reduce((a, b) => (b.price < a.price ? b : a));
  return { price: best.price, title: name ?? title, inStock: pool.length > 0, currency: best.currency };
}
