import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, getMeta, setMeta, type Sql } from './db';
import { plaidEnv } from './plaid';
import { merchantKey } from './recurring';
import {
  FREQUENCIES, assign, cleanMapping, columnLabels, guessColumns, isIncome, limitFor, monthRange, noticeFor, perMonth, readTable, rowsFromTable, suggest,
  type BudgetTxn, type Frequency, type Line, type Mapping, type Notice, type SheetRow,
} from './budget-rules';

const GROUP_ORDER = ['Income', 'Giving', 'Savings', 'Home', 'Car', 'Food', 'Personal', 'Subscriptions'];

function fromRow(r: any): Line {
  const match = typeof r.match === 'string' ? JSON.parse(r.match) : r.match;
  return {
    id: r.id,
    name: r.name,
    group: r.grp,
    direction: r.direction === 'in' ? 'in' : 'out',
    amount: Number(r.amount),
    frequency: (FREQUENCIES.includes(r.frequency) ? r.frequency : 'monthly') as Frequency,
    kind: r.kind === 'fixed' ? 'fixed' : 'variable',
    need: r.need === 'need' || r.need === 'want' ? r.need : '',
    note: r.note ?? '',
    match: Array.isArray(match) ? match.filter((m: unknown) => typeof m === 'string') : [],
    ord: Number(r.ord),
  };
}

/** Tidy whatever the browser (or the starter file) sends into a safe line. Returns null if it has no name. */
export function cleanLine(input: Record<string, unknown>, ord: number): Omit<Line, 'id'> | null {
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const name = text(input.name, 80);
  if (!name) return null;
  const amount = Number(input.amount);
  const match = Array.isArray(input.match)
    ? input.match.filter((m): m is string => typeof m === 'string' && /^(m|cat):.{1,60}$/.test(m)).slice(0, 30)
    : [];
  return {
    name,
    group: text(input.group, 40) || 'Other',
    direction: input.direction === 'in' ? 'in' : 'out',
    amount: Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : 0,
    frequency: (FREQUENCIES as string[]).includes(input.frequency as string) ? (input.frequency as Frequency) : 'monthly',
    kind: input.kind === 'fixed' ? 'fixed' : 'variable',
    need: input.need === 'need' || input.need === 'want' ? input.need : '',
    note: text(input.note, 200),
    match,
    ord: typeof input.ord === 'number' && Number.isFinite(input.ord) ? input.ord : ord,
  };
}

async function insertLine(sql: Sql, id: string, l: Omit<Line, 'id'>): Promise<void> {
  await sql.query(
    `INSERT INTO budget_lines (id, name, grp, direction, amount, frequency, kind, need, note, match, ord)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, grp = EXCLUDED.grp, direction = EXCLUDED.direction, amount = EXCLUDED.amount,
       frequency = EXCLUDED.frequency, kind = EXCLUDED.kind, need = EXCLUDED.need, note = EXCLUDED.note, match = EXCLUDED.match, ord = EXCLUDED.ord`,
    [id, l.name, l.group, l.direction, l.amount, l.frequency, l.kind, l.need, l.note, JSON.stringify(l.match), l.ord],
  );
}

/** First visit only: load seed/budget.json (your paper worksheet) if it is there. */
async function seedOnce(sql: Sql): Promise<void> {
  if (await getMeta(sql, 'budget_seeded')) return;
  const file = path.resolve('./seed/budget.json');
  if (!fs.existsSync(file)) return;
  if ((await sql.query('SELECT 1 FROM budget_lines LIMIT 1')).rows.length === 0) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { lines?: Record<string, unknown>[] };
    let ord = 0;
    for (const item of raw.lines ?? []) {
      const l = cleanLine(item, ord++);
      if (l) await insertLine(sql, crypto.randomUUID(), l);
    }
  }
  await setMeta(sql, 'budget_seeded', new Date().toISOString());
}

export async function getLines(sql: Sql): Promise<Line[]> {
  await seedOnce(sql);
  return (await sql.query('SELECT * FROM budget_lines ORDER BY ord, name')).rows.map(fromRow);
}

export async function saveLine(input: Record<string, unknown>): Promise<Line | null> {
  const sql = await db();
  const lines = await getLines(sql);
  const id = typeof input.id === 'string' && lines.some((l) => l.id === input.id) ? input.id : crypto.randomUUID();
  const existing = lines.find((l) => l.id === id);
  const l = cleanLine({ ...existing, ...input }, existing?.ord ?? (lines.length ? Math.max(...lines.map((x) => x.ord)) + 1 : 0));
  if (!l) return null;
  await insertLine(sql, id, l);
  return { id, ...l };
}

export async function deleteLine(id: string): Promise<void> {
  const sql = await db();
  await sql.query('DELETE FROM txn_overrides WHERE line_id = $1', [id]);
  await sql.query('DELETE FROM budget_lines WHERE id = $1', [id]);
}

/**
 * Put one transaction on a line (lineId null = "not spending").
 * With remember, the merchant is added to that line's rules so future charges go there by themselves.
 */
export async function assignTxn(txnId: string, lineId: string | null, remember: boolean): Promise<boolean> {
  const sql = await db();
  const t = (await sql.query('SELECT name, merchant_name FROM transactions WHERE id = $1', [txnId])).rows[0];
  if (!t) return false;
  const lines = await getLines(sql);
  const line = lineId ? lines.find((l) => l.id === lineId) : null;
  if (lineId && !line) return false;
  await sql.query('INSERT INTO txn_overrides (txn_id, line_id) VALUES ($1, $2) ON CONFLICT (txn_id) DO UPDATE SET line_id = EXCLUDED.line_id', [txnId, lineId]);
  if (line && remember) {
    const key = merchantKey({ name: t.name, merchant: t.merchant_name });
    const rule = 'm:' + key;
    if (key.length >= 3 && key.length <= 60 && !line.match.includes(rule)) {
      await sql.query('UPDATE budget_lines SET match = $2::jsonb WHERE id = $1', [line.id, JSON.stringify([...line.match, rule])]);
    }
  }
  return true;
}

/**
 * Bring in rows from an uploaded .csv file. The columns are guessed, and the guess can be corrected by
 * sending a mapping back. A row whose name matches an existing line updates that line's amount (and
 * schedule, if given); other rows become new lines. Nothing is ever deleted.
 */
export async function importSheet(text: string, mappingInput: unknown, apply: boolean) {
  const sql = await db();
  const lines = await getLines(sql);
  const table = readTable(text).slice(0, 1000);
  const width = Math.max(0, ...table.map((r) => r.length));
  const mapping: Mapping = cleanMapping(mappingInput, width) ?? guessColumns(table);
  const byName = new Map(lines.map((l) => [l.name.toLowerCase(), l]));
  const rows: (SheetRow & { action: 'update' | 'add' })[] = rowsFromTable(table, mapping)
    .slice(0, 300)
    .map((r) => ({ ...r, action: byName.has(r.name.toLowerCase()) ? ('update' as const) : ('add' as const) }));
  if (apply) {
    let ord = lines.length ? Math.max(...lines.map((l) => l.ord)) + 1 : 0;
    for (const r of rows) {
      const existing = byName.get(r.name.toLowerCase());
      const merged = cleanLine({ ...existing, name: existing?.name ?? r.name, amount: r.amount, ...(r.frequency && { frequency: r.frequency }),
        ...(r.kind && { kind: r.kind }), ...(r.group && { group: r.group }), ...(!existing && !r.group && { group: 'Imported' }) }, existing?.ord ?? ord++);
      if (merged) {
        const id = existing?.id ?? crypto.randomUUID();
        await insertLine(sql, id, merged);
        byName.set(r.name.toLowerCase(), { id, ...merged }); // a name repeated in the file updates, not duplicates
      }
    }
  }
  return { columns: columnLabels(table, mapping), mapping, rows, tableRows: table.length, applied: apply };
}

/** Everything needed to rebuild the plan elsewhere: every line with its sorting rules. No bank data. */
export async function exportBudget() {
  const lines = await getLines(await db());
  return { _about: 'Budget backup. Restore it from the Budget tab.', exported: new Date().toISOString(), lines: lines.map(({ id: _id, ...rest }) => rest) };
}

/** Load a backup made by exportBudget (or seed/budget.json). Lines are matched by name: existing ones are replaced, others added, none removed. */
export async function restoreBudget(input: unknown): Promise<number> {
  const raw = (input && typeof input === 'object' ? (input as { lines?: unknown }).lines : null);
  if (!Array.isArray(raw)) throw new Error('That file is not a budget backup');
  const sql = await db();
  const lines = await getLines(sql);
  const byName = new Map(lines.map((l) => [l.name.toLowerCase(), l]));
  let ord = lines.length ? Math.max(...lines.map((l) => l.ord)) + 1 : 0;
  let count = 0;
  for (const item of raw.slice(0, 500)) {
    if (!item || typeof item !== 'object') continue;
    const fresh = cleanLine(item as Record<string, unknown>, ord);
    if (!fresh) continue;
    const existing = byName.get(fresh.name.toLowerCase());
    const id = existing?.id ?? crypto.randomUUID();
    if (!existing) ord++;
    await insertLine(sql, id, { ...fresh, ord: existing?.ord ?? fresh.ord });
    byName.set(fresh.name.toLowerCase(), { id, ...fresh });
    count++;
  }
  return count;
}

/** The whole Budget screen for one month (YYYY-MM): the plan, what was actually spent, and what still needs sorting. */
export async function getBudget(month: string) {
  const sql = await db();
  const lines = await getLines(sql);
  const { from, to } = monthRange(month);
  const txns: BudgetTxn[] = (await sql.query(
    `SELECT t.id, t.date, t.name, t.merchant_name, t.amount, t.category, t.category_detail
     FROM transactions t JOIN items i ON i.id = t.item_id
     WHERE i.plaid_env = $1 AND NOT t.pending AND t.date >= $2 AND t.date < $3 ORDER BY t.date DESC`,
    [plaidEnv(), from, to],
  )).rows.map((r) => ({
    id: r.id, date: r.date, name: r.name, merchant: r.merchant_name, amount: Number(r.amount), category: r.category, detail: r.category_detail,
  }));
  const overrides = new Map<string, string | null>(
    (await sql.query('SELECT txn_id, line_id FROM txn_overrides')).rows.map((r) => [r.txn_id as string, (r.line_id ?? null) as string | null]),
  );

  const spent = new Map<string, number>();
  const unassigned: BudgetTxn[] = [];
  let incomeReceived = 0;
  for (const t of txns) {
    const where = assign(t, lines, overrides);
    if (where === 'unassigned') unassigned.push(t);
    else if (where) spent.set(where, (spent.get(where) ?? 0) + t.amount);
    else if (isIncome(t)) incomeReceived += -t.amount;
  }

  const view = lines.map((l) => {
    const s = Math.round((spent.get(l.id) ?? 0) * 100) / 100;
    return { ...l, monthly: perMonth(l), limit: limitFor(l), spent: s, notice: noticeFor(l, s) };
  });
  const notices = view.map((l) => l.notice).filter((n): n is Notice => n !== null)
    .sort((a, b) => (a.level === b.level ? a.left - b.left : a.level === 'over' ? -1 : 1));
  const outs = view.filter((l) => l.direction === 'out');
  const names = [...new Set(view.map((l) => l.group))];
  const rank = (g: string) => (GROUP_ORDER.includes(g) ? GROUP_ORDER.indexOf(g) : GROUP_ORDER.length);
  const groups = names
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((name) => {
      const ls = view.filter((l) => l.group === name);
      return { name, direction: ls[0].direction, planned: ls.reduce((n, l) => n + l.monthly, 0), spent: ls.reduce((n, l) => n + l.spent, 0), lines: ls };
    });

  const plannedIncome = view.filter((l) => l.direction === 'in').reduce((n, l) => n + l.monthly, 0);
  const planned = outs.reduce((n, l) => n + l.monthly, 0);
  const unassignedTotal = unassigned.reduce((n, t) => n + t.amount, 0);
  const thisMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
  const finished = month < thisMonth;
  const basis = finished ? incomeReceived : Math.max(incomeReceived, plannedIncome);
  const basedOn = finished || incomeReceived >= plannedIncome ? ('received' as const) : ('expected' as const);
  return {
    month,
    totals: {
      plannedIncome,
      incomeReceived,
      planned,
      spent: outs.reduce((n, l) => n + l.spent, 0) + unassignedTotal,
      leftToPlan: plannedIncome - planned,
      unassigned: unassignedTotal,
    },
    groups,
    notices,
    // A finished month uses the income that actually arrived. The month in progress uses whichever is larger,
    // received or planned, so the first week of the month is not treated as a pay cut.
    suggestion: { basedOn, ...suggest(lines, basis) },
    unassigned: unassigned.slice(0, 100),
    hasTransactions: txns.length > 0,
  };
}

export type Budget = Awaited<ReturnType<typeof getBudget>>;
export type BudgetLine = Budget['groups'][number]['lines'][number];
