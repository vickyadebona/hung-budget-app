import { db, type Sql } from './db';
import { assess, saleSeason, type Assessment, type SaleSeason } from './deals';
import { checkPrice } from './price-fetch';
import { parseWebUrl, storeName } from './url-safety';
import { saveGoal } from './goals';

export interface WishLink {
  id: string;
  url: string;
  store: string;
  price: number | null;
  previous: number | null;
  status: string; // ok, manual, unreadable, blocked, error, pending
  message: string;
  checkedAt: string | null;
  inStock: boolean | null;
  best: boolean;
}

export interface WishItem extends Assessment {
  id: string;
  name: string;
  note: string;
  targetPrice: number | null;
  bought: boolean;
  links: WishLink[];
  bestPrice: number | null;
  bestStore: string | null;
  lowestSeen: boolean;
  priceDate: string | null;
}

export interface Wishlist { items: WishItem[]; sale: SaleSeason | null; today: string }

const today = () => new Date().toISOString().slice(0, 10);
const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const money = (n: unknown) => (n == null ? null : Math.round(Number(n) * 100) / 100);

export async function getWishlist(): Promise<Wishlist> {
  const sql = await db();
  const items = (await sql.query('SELECT id, name, note, target_price, bought_at FROM wishlist_items ORDER BY (bought_at IS NOT NULL), created_at, id')).rows;
  const links = (await sql.query('SELECT id, item_id, url, store, price, price_prev, status, message, checked_at, in_stock FROM wishlist_links ORDER BY created_at, id')).rows;
  const hist = (await sql.query('SELECT link_id, price FROM wishlist_prices')).rows;
  const t = today();

  const out: WishItem[] = items.map((it) => {
    const mine = links.filter((l) => l.item_id === it.id);
    const priced = mine.filter((l) => l.price != null && l.in_stock !== false);
    const pool = priced.length ? priced : mine.filter((l) => l.price != null);
    const best = pool.length ? pool.reduce((a, b) => (Number(b.price) < Number(a.price) ? b : a)) : null;
    const ids = new Set(mine.map((l) => l.id));
    const prices = hist.filter((h) => ids.has(h.link_id)).map((h) => Number(h.price));
    const a = assess({
      current: best ? Number(best.price) : null,
      previous: best?.price_prev != null ? Number(best.price_prev) : null,
      lowest: prices.length ? Math.min(...prices) : null,
      readings: prices.length,
      target: it.target_price != null ? Number(it.target_price) : null,
    });
    return {
      id: it.id, name: it.name, note: it.note ?? '', targetPrice: money(it.target_price), bought: it.bought_at != null,
      links: mine.map((l) => ({
        id: l.id, url: l.url, store: l.store, price: money(l.price), previous: money(l.price_prev), status: l.status,
        message: l.message ?? '', checkedAt: l.checked_at ?? null, inStock: l.in_stock ?? null, best: best?.id === l.id,
      })),
      bestPrice: best ? money(best.price) : null, bestStore: best?.store ?? null,
      priceDate: mine.map((l) => l.checked_at).filter(Boolean).sort().pop() ?? null,
      ...a,
    };
  });
  return { items: out, sale: saleSeason(t), today: t };
}

export function cleanItem(b: { name?: unknown; note?: unknown; targetPrice?: unknown }): { name: string; note: string; targetPrice: number | null } | string {
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : '';
  if (!name) return 'Give it a name';
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 300) : '';
  const raw = typeof b.targetPrice === 'number' ? b.targetPrice : Number(String(b.targetPrice ?? '').replace(/[$,\s]/g, ''));
  const hasTarget = !(b.targetPrice === '' || b.targetPrice == null);
  if (hasTarget && (!Number.isFinite(raw) || raw <= 0 || raw > 100_000_000)) return 'Enter a price above $0, or leave it blank';
  return { name, note, targetPrice: hasTarget ? Math.round(raw * 100) / 100 : null };
}

/** Adds an item. Returns its id, or an error message. */
export async function saveItem(b: { id?: string; name?: unknown; note?: unknown; targetPrice?: unknown }, by: string): Promise<{ id: string } | string> {
  const c = cleanItem(b);
  if (typeof c === 'string') return c;
  const sql = await db();
  if (b.id) {
    await sql.query('UPDATE wishlist_items SET name=$2, note=$3, target_price=$4 WHERE id=$1', [b.id, c.name, c.note, c.targetPrice]);
    return { id: b.id };
  }
  const id = newId();
  await sql.query('INSERT INTO wishlist_items (id, name, note, target_price, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [id, c.name, c.note, c.targetPrice, by, new Date().toISOString()]);
  return { id };
}

export async function deleteItem(id: string) {
  const sql = await db();
  await sql.query('DELETE FROM wishlist_prices WHERE link_id IN (SELECT id FROM wishlist_links WHERE item_id = $1)', [id]);
  await sql.query('DELETE FROM wishlist_links WHERE item_id = $1', [id]);
  await sql.query('DELETE FROM wishlist_items WHERE id = $1', [id]);
}

export async function setBought(id: string, bought: boolean) {
  const sql = await db();
  await sql.query('UPDATE wishlist_items SET bought_at = $2 WHERE id = $1', [id, bought ? new Date().toISOString() : null]);
}

/** Records a price for a link. Keeps the one before it, so a drop can be shown, and one reading a day for the history. */
async function recordPrice(sql: Sql, linkId: string, price: number, status: string, message: string, inStock: boolean | null) {
  const cur = (await sql.query('SELECT price FROM wishlist_links WHERE id = $1', [linkId])).rows[0];
  if (!cur) return;
  const changed = cur.price == null || Math.abs(Number(cur.price) - price) >= 0.005;
  await sql.query(
    `UPDATE wishlist_links SET price = $2, price_prev = CASE WHEN $3 THEN price ELSE price_prev END, status = $4, message = $5, checked_at = $6, in_stock = $7 WHERE id = $1`,
    [linkId, price, changed && cur.price != null, status, message, new Date().toISOString(), inStock],
  );
  await sql.query('INSERT INTO wishlist_prices (link_id, date, price) VALUES ($1,$2,$3) ON CONFLICT (link_id, date) DO UPDATE SET price = EXCLUDED.price', [linkId, today(), price]);
}

async function checkLink(sql: Sql, linkId: string, url: string): Promise<{ title: string | null }> {
  const r = await checkPrice(url);
  if (r.status === 'ok') {
    await recordPrice(sql, linkId, r.parsed.price!, 'ok', '', r.parsed.inStock);
    return { title: r.parsed.title };
  }
  // Keep any older price; just say why it could not be refreshed.
  await sql.query('UPDATE wishlist_links SET status = CASE WHEN status = \'manual\' AND price IS NOT NULL THEN status ELSE $2 END, message = $3, checked_at = $4 WHERE id = $1', [linkId, r.status, r.message, new Date().toISOString()]);
  return { title: null };
}

export async function addLink(itemId: string, rawUrl: string): Promise<{ title: string | null } | string> {
  const u = parseWebUrl(rawUrl);
  if (!u) return 'That does not look like a web link';
  const sql = await db();
  if (!(await sql.query('SELECT 1 FROM wishlist_items WHERE id = $1', [itemId])).rows.length) return 'Item not found';
  const id = newId();
  await sql.query(
    `INSERT INTO wishlist_links (id, item_id, url, store, status, message, created_at) VALUES ($1,$2,$3,$4,'pending','',$5)`,
    [id, itemId, u.href, storeName(u.hostname), new Date().toISOString()],
  );
  return checkLink(sql, id, u.href);
}

export async function setLinkPrice(linkId: string, price: number): Promise<string | null> {
  if (!Number.isFinite(price) || price <= 0 || price > 100_000_000) return 'Enter a price above $0';
  const sql = await db();
  if (!(await sql.query('SELECT 1 FROM wishlist_links WHERE id = $1', [linkId])).rows.length) return 'Link not found';
  await recordPrice(sql, linkId, Math.round(price * 100) / 100, 'manual', '', true);
  return null;
}

export async function deleteLink(linkId: string) {
  const sql = await db();
  await sql.query('DELETE FROM wishlist_prices WHERE link_id = $1', [linkId]);
  await sql.query('DELETE FROM wishlist_links WHERE id = $1', [linkId]);
}

/** Re-reads prices. Limited per run so it fits in one serverless call, four pages at a time. */
export async function refreshPrices(itemId?: string, limit = 24): Promise<{ checked: number; updated: number }> {
  const sql = await db();
  const rows = (await sql.query(
    `SELECT l.id, l.url FROM wishlist_links l JOIN wishlist_items i ON i.id = l.item_id
     WHERE i.bought_at IS NULL ${itemId ? 'AND l.item_id = $1' : ''} ORDER BY l.checked_at NULLS FIRST, l.id LIMIT ${Math.max(1, Math.min(60, limit))}`,
    itemId ? [itemId] : [],
  )).rows;
  let updated = 0;
  for (let i = 0; i < rows.length; i += 4) {
    const batch = await Promise.all(rows.slice(i, i + 4).map(async (r) => {
      await checkLink(sql, r.id, r.url);
      return (await sql.query('SELECT status FROM wishlist_links WHERE id = $1', [r.id])).rows[0]?.status === 'ok';
    }));
    updated += batch.filter(Boolean).length;
  }
  return { checked: rows.length, updated };
}

/** "Save for this": makes a savings goal sized to the best price now. */
export async function itemToGoal(itemId: string, accountId?: string): Promise<string | null> {
  const w = await getWishlist();
  const it = w.items.find((i) => i.id === itemId);
  if (!it) return 'Item not found';
  const target = it.bestPrice ?? it.targetPrice;
  if (target == null) return 'Add a price first so the goal knows how much to save';
  return saveGoal({ name: it.name, target, accountId });
}
