import dns from 'node:dns/promises';
import { isBlockedHostname, isPrivateAddress, parseWebUrl } from './url-safety';
import { parsePrice, type Parsed } from './price-parse';

export type Check = { status: 'ok'; parsed: Parsed } | { status: 'unreadable' | 'blocked' | 'error'; message: string };

const MAX_BYTES = 1_500_000;
const UA = 'Mozilla/5.0 (compatible; HouseholdBudgetBot/1.0)';

/** Refuses anything that would reach a private network, including after a redirect. */
async function allowed(u: URL): Promise<boolean> {
  if (isBlockedHostname(u.hostname)) return false;
  try {
    const addrs = await dns.lookup(u.hostname, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  void reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString('utf8');
}

/** Loads a product page and reads its price. Never throws. */
export async function checkPrice(raw: string): Promise<Check> {
  const first = parseWebUrl(raw);
  if (!first) return { status: 'error', message: 'That does not look like a web link' };
  let u: URL = first;
  try {
    for (let hop = 0; hop < 4; hop++) {
      if (!(await allowed(u))) return { status: 'error', message: 'That address cannot be checked' };
      const res = await fetch(u, {
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' },
      });
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get('location');
        const nu = next ? parseWebUrl(new URL(next, u).href) : null;
        if (!nu) return { status: 'error', message: 'The store sent us somewhere we could not follow' };
        u = nu;
        continue;
      }
      if (res.status === 403 || res.status === 429 || res.status === 503) return { status: 'blocked', message: 'This store does not let us read prices automatically' };
      if (!res.ok) return { status: 'error', message: `The store answered with an error (${res.status})` };
      if (!/html|xml/i.test(res.headers.get('content-type') ?? '')) return { status: 'unreadable', message: 'That link is not a web page' };
      const parsed = parsePrice(await readCapped(res));
      if (parsed.price == null) return { status: 'unreadable', message: 'Could not find a price on that page' };
      if (parsed.currency && parsed.currency !== 'USD') return { status: 'unreadable', message: `That page shows prices in ${parsed.currency}` };
      return { status: 'ok', parsed };
    }
    return { status: 'error', message: 'Too many redirects' };
  } catch (e) {
    return { status: 'error', message: e instanceof Error && e.name === 'TimeoutError' ? 'The store took too long to answer' : 'Could not reach the store' };
  }
}
