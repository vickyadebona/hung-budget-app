/** Checks for a link someone typed in before the server goes and fetches it. Pure, so it can be tested. */

export function parseWebUrl(raw: string): URL | null {
  const s = raw.trim();
  if (!s || s.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== '80' && u.port !== '443') return null;
  return u;
}

export function isPrivateAddress(ip: string): boolean {
  const a = ip.toLowerCase();
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  const v4 = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [x, y] = [Number(v4[1]), Number(v4[2])];
    return (
      x === 0 || x === 10 || x === 127 || x >= 224 ||
      (x === 100 && y >= 64 && y <= 127) ||
      (x === 169 && y === 254) ||
      (x === 172 && y >= 16 && y <= 31) ||
      (x === 192 && y === 168) ||
      (x === 192 && y === 0)
    );
  }
  if (a.includes(':')) {
    return a === '::' || a === '::1' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a);
  }
  return true; // not an address we understand
}

export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
  if (/^[\d.]+$/.test(h) || h.includes(':') || h.startsWith('[')) return isPrivateAddress(h.replace(/^\[|\]$/g, ''));
  return !h.includes('.');
}

/** "www.bestbuy.com" -> "Bestbuy". Good enough as a label for a store. */
export function storeName(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, '').split('.');
  const main = parts.length >= 3 && parts[parts.length - 2].length <= 3 ? parts[parts.length - 3] : parts[parts.length - 2] ?? parts[0];
  const known: Record<string, string> = { amazon: 'Amazon', bestbuy: 'Best Buy', walmart: 'Walmart', target: 'Target', costco: 'Costco', bhphotovideo: 'B&H', adorama: 'Adorama', ebay: 'eBay', newegg: 'Newegg', homedepot: 'Home Depot', lowes: "Lowe's" };
  return known[main] ?? main.charAt(0).toUpperCase() + main.slice(1);
}
