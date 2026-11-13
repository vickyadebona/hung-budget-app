import type { Sql } from './db';

/**
 * When both of you link the same bank, accounts you share (a joint checking account, a shared card)
 * come in twice, once through each login. This finds those pairs so they are shown and counted once.
 *
 * Two accounts are the same account when they come from different logins at the same bank, with the
 * same type and last four digits, and also the same name or the same balance.
 */
export interface AccountLike {
  id: string;
  item_id: string;
  name: string;
  type: string;
  subtype: string | null;
  mask: string | null;
  current: number | null;
  institution: string; // institution id when known, else its name
  itemCreated: string; // the earlier login keeps the account
}

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Map of duplicate account id -> the account id that is kept. */
export function findDuplicates(accounts: AccountLike[]): Map<string, string> {
  const groups = new Map<string, AccountLike[]>();
  for (const a of accounts) {
    if (!a.mask) continue; // without the last four digits there is nothing safe to match on
    const key = [norm(a.institution), a.type, a.subtype ?? '', a.mask].join('|');
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(a);
  }
  const dup = new Map<string, string>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((x, y) => x.itemCreated.localeCompare(y.itemCreated) || x.id.localeCompare(y.id));
    const kept: AccountLike[] = [];
    for (const a of list) {
      const match = kept.find(
        (k) => k.item_id !== a.item_id &&
          (norm(k.name) === norm(a.name) || (k.current != null && a.current != null && Math.abs(k.current - a.current) < 1)),
      );
      if (match) dup.set(a.id, match.id);
      else kept.push(a);
    }
  }
  return dup;
}


/** Loads every account for the current Plaid environment and works out which ones are shared duplicates. */
export async function sharedAccounts(sql: Sql, plaidEnv: string): Promise<{ dup: Map<string, string>; shared: Set<string> }> {
  const rows = (await sql.query(
    `SELECT a.id, a.item_id, a.name, a.type, a.subtype, a.mask, a.current, COALESCE(i.institution_id, i.institution_name) AS institution, i.created_at
     FROM accounts a JOIN items i ON i.id = a.item_id WHERE i.plaid_env = $1`,
    [plaidEnv],
  )).rows;
  const dup = findDuplicates(rows.map((r) => ({
    id: r.id, item_id: r.item_id, name: r.name, type: r.type, subtype: r.subtype, mask: r.mask,
    current: r.current == null ? null : Number(r.current), institution: r.institution ?? '', itemCreated: r.created_at,
  })));
  return { dup, shared: new Set(dup.values()) };
}
