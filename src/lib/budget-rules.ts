/**
 * Pure budget maths: no database, no network, so it is easy to test.
 * A budget "line" is one row of the plan (Groceries, Rent, Spotify...).
 */
import { merchantKey } from './recurring.ts';

export type Frequency = 'weekly' | 'biweekly' | 'twice-monthly' | 'monthly' | 'yearly';
export const FREQUENCIES: Frequency[] = ['weekly', 'biweekly', 'twice-monthly', 'monthly', 'yearly'];

export interface Line {
  id: string;
  name: string;
  group: string;
  direction: 'out' | 'in';
  amount: number;
  frequency: Frequency;
  kind: 'fixed' | 'variable';
  need: 'need' | 'want' | '';
  note: string;
  /** Rules that send a transaction here: "m:netflix" (merchant contains) or "cat:FOOD_AND_DRINK" (bank category starts with). */
  match: string[];
  ord: number;
}

export interface BudgetTxn {
  id: string;
  date: string;
  name: string;
  merchant: string | null;
  amount: number; // positive = money out
  category: string | null; // e.g. FOOD_AND_DRINK
  detail: string | null; // e.g. FOOD_AND_DRINK_GROCERIES
}

const PER_MONTH: Record<Frequency, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  'twice-monthly': 2,
  monthly: 1,
  yearly: 1 / 12,
};

/** What a line comes to per month, whatever schedule it is really paid on. */
export function perMonth(line: Pick<Line, 'amount' | 'frequency'>): number {
  return line.amount * (PER_MONTH[line.frequency] ?? 1);
}

// Money moving between your own accounts is not spending. Counting a card payment as well as
// the purchases on that card would count everything twice.
const NOT_SPENDING = ['TRANSFER_IN', 'TRANSFER_OUT', 'INCOME', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'];
const startsWithAny = (value: string | null, prefixes: string[]) => !!value && prefixes.some((p) => value.startsWith(p));

export function isIncome(t: BudgetTxn): boolean {
  return t.amount < 0 && (t.category === 'INCOME' || startsWithAny(t.detail, ['INCOME']));
}

/**
 * Decide which line a transaction belongs to.
 * Order: your manual choice, then merchant rules, then bank-category rules (most specific wins).
 * Returns a line id, 'unassigned' (real spending with no home yet), or null (not spending at all).
 */
export function assign(t: BudgetTxn, lines: Line[], overrides: Map<string, string | null>): string | 'unassigned' | null {
  if (overrides.has(t.id)) {
    const chosen = overrides.get(t.id);
    if (chosen === null) return null; // you marked it "not spending"
    if (chosen && lines.some((l) => l.id === chosen)) return chosen;
  }
  const out = lines.filter((l) => l.direction === 'out');

  const key = merchantKey({ name: t.name, merchant: t.merchant });
  let best: { id: string; len: number } | null = null;
  for (const l of out) {
    for (const rule of l.match) {
      if (!rule.startsWith('m:')) continue;
      const needle = rule.slice(2).toLowerCase().trim();
      if (needle && key.includes(needle) && (!best || needle.length > best.len)) best = { id: l.id, len: needle.length };
    }
  }
  if (best) return best.id;

  for (const l of out) {
    for (const rule of l.match) {
      if (!rule.startsWith('cat:')) continue;
      const cat = rule.slice(4);
      const hit = (t.detail && t.detail.startsWith(cat)) || t.category === cat;
      if (hit && (!best || cat.length > best.len)) best = { id: l.id, len: cat.length };
    }
  }
  if (best) return best.id;

  if (startsWithAny(t.category, NOT_SPENDING) || startsWithAny(t.detail, NOT_SPENDING)) return null;
  if (t.amount <= 0) return null; // a refund or deposit that matches no line
  return 'unassigned';
}

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { from: `${month}-01`, to: `${next}-01` };
}

export function isMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/* ---------- notices: over budget, or nearly there ---------- */

export const LOW_LEFT = 50; // dollars

export type Notice = { lineId: string; name: string; level: 'over' | 'low'; left: number; limit: number };

/** A yearly bill lands in one month, so it is compared with the full yearly amount, not a twelfth of it. */
export function limitFor(line: Pick<Line, 'amount' | 'frequency'>): number {
  return line.frequency === 'yearly' ? line.amount : perMonth(line);
}

/**
 * "Over" once spending passes the limit. "Low" when $50 or less is left and at least half is used
 * (so a $40 budget does not nag from day one). A fixed bill paid exactly in full is done, not low.
 */
export function noticeFor(line: Pick<Line, 'id' | 'name' | 'amount' | 'frequency' | 'direction'> & Partial<Pick<Line, 'kind'>>, spent: number, lowLeft = LOW_LEFT): Notice | null {
  if (line.direction !== 'out') return null;
  const limit = limitFor(line);
  if (limit <= 0 || spent <= 0) return null;
  const left = Math.round((limit - spent) * 100) / 100;
  if (left < 0) return { lineId: line.id, name: line.name, level: 'over', left, limit };
  if (line.kind === 'fixed' && left === 0) return null;
  if (left <= lowLeft && spent >= limit / 2) return { lineId: line.id, name: line.name, level: 'low', left, limit };
  return null;
}

/* ---------- suggestions: fit the plan to the income that actually arrived ---------- */

export interface Suggestion {
  income: number;
  fixed: number; // bills that do not flex
  flexible: number; // what the plan asks for on flexible lines
  available: number; // income minus fixed bills
  scale: number; // 1 = plan fits as written
  shortfall: number; // > 0 when fixed bills alone exceed income
  lines: { id: string; name: string; group: string; planned: number; suggested: number }[];
}

/**
 * Fixed bills are paid first, exactly as planned. Whatever income is left is shared between the
 * flexible lines in the same proportions as your plan, rounded down to the nearest $5.
 * Extra income is never spread around: it shows up as money left over for you to decide on.
 */
export function suggest(lines: Line[], income: number): Suggestion {
  const outs = lines.filter((l) => l.direction === 'out');
  const fixedLines = outs.filter((l) => l.kind === 'fixed');
  const flexLines = outs.filter((l) => l.kind !== 'fixed');
  const fixed = fixedLines.reduce((n, l) => n + perMonth(l), 0);
  const flexible = flexLines.reduce((n, l) => n + perMonth(l), 0);
  const available = income - fixed;
  const scale = flexible <= 0 ? 1 : Math.max(0, Math.min(1, available / flexible));
  return {
    income,
    fixed,
    flexible,
    available,
    scale,
    shortfall: available < 0 ? -available : 0,
    lines: flexLines.map((l) => {
      const planned = perMonth(l);
      const raw = planned * scale;
      return { id: l.id, name: l.name, group: l.group, planned, suggested: scale >= 1 ? planned : Math.floor(raw / 5) * 5 };
    }),
  };
}

/* ---------- import: a .csv file in whatever layout the spreadsheet happens to have ---------- */

export interface SheetRow {
  name: string;
  amount: number;
  frequency?: Frequency;
  group?: string;
  kind?: 'fixed' | 'variable';
}

/** Which column holds what. -1 means "none". header is the row of column titles (-1 = no title row). */
export interface Mapping {
  header: number;
  name: number;
  amount: number;
  frequency: number;
  group: number;
  kind: number;
}

/** Split CSV (or tab-separated) text into cells. Handles quotes, commas and line breaks inside quotes. */
export function readTable(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = firstLine.includes('\t') ? '\t' : firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  const table: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  const endCell = () => { row.push(cur.trim()); cur = ''; };
  const endRow = () => { endCell(); if (row.some((c) => c)) table.push(row); row = []; };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur.trim() === '') quoted = true;
    else if (ch === delim) endCell();
    else if (ch === '\n') endRow();
    else if (ch !== '\r') cur += ch;
  }
  endRow();
  return table;
}

function toAmount(cell: string): number | null {
  const m = cell.toLowerCase().replace(/(\/|per |a )\s*(mo(nth)?|yr|year|wk|week)\.?$/, '').replace(/(usd|[$,\s])/g, '');
  if (!/^\(?-?\d+(\.\d+)?\)?$/.test(m)) return null;
  return Math.abs(Number(m.replace(/[()]/g, '')));
}

function toFrequency(cell: string): Frequency | undefined {
  const c = cell.toLowerCase();
  if (c.length > 30) return undefined;
  if (/twice|semi|2x/.test(c)) return 'twice-monthly';
  if (/bi-?week|every (2|two|other) week/.test(c)) return 'biweekly';
  if (/week/.test(c)) return 'weekly';
  if (/annual|year/.test(c)) return 'yearly';
  if (/month/.test(c)) return 'monthly';
  return undefined;
}

const HEAD = {
  name: /^(category|categories|name|item|items|expense|expenses|description|bill|bills|line item|budget (line|category|item))$/,
  amount: /^(amount|\$+|budget|budgeted|planned|plan|monthly|cost|price|total|expected|(monthly|budget|planned) (amount|cost|budget)|amount \(\$\))$/,
  frequency: /frequency|how often|schedule|cadence/,
  group: /^(group|section|type|bucket|area)$/,
  kind: /fixed/,
};

/**
 * Best guess at the layout. Looks for a row of column titles first (it need not be the first row);
 * failing that, the column with the most numbers is the amount and the column with the most words is the name.
 */
export function guessColumns(table: string[][]): Mapping {
  const find = (cells: string[], re: RegExp) => cells.findIndex((c) => re.test(c.toLowerCase().trim()));
  for (let i = 0; i < Math.min(table.length, 25); i++) {
    const name = find(table[i], HEAD.name);
    const amount = find(table[i], HEAD.amount);
    if (name >= 0 && amount >= 0 && name !== amount) {
      return { header: i, name, amount, frequency: find(table[i], HEAD.frequency), group: find(table[i], HEAD.group), kind: find(table[i], HEAD.kind) };
    }
  }
  const width = Math.max(0, ...table.map((r) => r.length));
  const count = (col: number, test: (c: string) => boolean) => table.reduce((n, r) => n + (r[col] && test(r[col]) ? 1 : 0), 0);
  const best = (score: (col: number) => number, skip: number[] = []) => {
    let top = -1;
    let topScore = 0;
    for (let c = 0; c < width; c++) {
      const s = skip.includes(c) ? 0 : score(c);
      if (s > topScore) { top = c; topScore = s; }
    }
    return top;
  };
  const amount = best((c) => count(c, (x) => toAmount(x) !== null));
  const frequency = best((c) => count(c, (x) => toFrequency(x) !== undefined), [amount]);
  const kind = best((c) => count(c, (x) => /^(fixed|variable)$/i.test(x)), [amount, frequency]);
  const name = best((c) => count(c, (x) => toAmount(x) === null), [amount, frequency, kind]);
  return { header: -1, name, amount, frequency, group: -1, kind };
}

/** Column titles to show in the picker: the title row if there is one, otherwise "Column A (first value)". */
export function columnLabels(table: string[][], mapping: Mapping): string[] {
  const width = Math.max(0, ...table.map((r) => r.length));
  return Array.from({ length: width }, (_, c) => {
    const letter = String.fromCharCode(65 + (c % 26));
    const title = mapping.header >= 0 ? table[mapping.header]?.[c] : '';
    if (title) return title.slice(0, 40);
    const sample = table.find((r, i) => i !== mapping.header && r[c])?.[c] ?? '';
    return sample ? `Column ${letter} (${sample.slice(0, 20)})` : `Column ${letter}`;
  });
}

/** Turn the table into budget rows using the chosen columns. Rows without a name and an amount are skipped. */
export function rowsFromTable(table: string[][], m: Mapping): SheetRow[] {
  if (m.name < 0 || m.amount < 0 || m.name === m.amount) return [];
  const out: SheetRow[] = [];
  table.forEach((r, i) => {
    if (i <= m.header) return;
    const name = (r[m.name] ?? '').slice(0, 80);
    const amount = toAmount(r[m.amount] ?? '');
    if (!name || amount === null) return;
    const row: SheetRow = { name, amount };
    const freq = m.frequency >= 0 ? toFrequency(r[m.frequency] ?? '') : undefined;
    if (freq) row.frequency = freq;
    if (m.group >= 0 && r[m.group]) row.group = r[m.group].slice(0, 40);
    const kind = m.kind >= 0 ? (r[m.kind] ?? '').toLowerCase() : '';
    if (/fixed/.test(kind)) row.kind = 'fixed';
    else if (/variable|flex/.test(kind)) row.kind = 'variable';
    out.push(row);
  });
  return out;
}

export function cleanMapping(input: unknown, width: number): Mapping | null {
  if (!input || typeof input !== 'object') return null;
  const v = input as Record<string, unknown>;
  const col = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < width ? x : -1);
  const header = typeof v.header === 'number' && Number.isInteger(v.header) && v.header >= 0 ? v.header : -1;
  return { header, name: col(v.name), amount: col(v.amount), frequency: col(v.frequency), group: col(v.group), kind: col(v.kind) };
}

/** One-step version: read the text and trust the guess. */
export function parseSheet(text: string): SheetRow[] {
  const table = readTable(text);
  return rowsFromTable(table, guessColumns(table));
}
