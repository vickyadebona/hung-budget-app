import { setMeta, type Sql } from './db';
import { plaidEnv } from './plaid';

/**
 * Made-up household for demo mode. Everything here is invented: the people, banks, balances and charges.
 * Dates are built from today, so the demo always looks current. It loads into a memory-only database
 * (see db.ts), never into the real one.
 */

export const DEMO_USER = { email: 'alex@example.com', name: 'Alex Rivera' };
const PARTNER = 'sam@example.com';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
const shift = (date: string, days: number) => new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const dom = (date: string) => Number(date.slice(8, 10));
const dow = (date: string) => new Date(date + 'T12:00:00Z').getUTCDay(); // 0 = Sunday

/** The next date on or after `from` that falls on day-of-month `d`. */
function nextOnDay(from: string, d: number): string {
  for (let i = 0; i < 40; i++) {
    const x = shift(from, i);
    if (dom(x) === d) return x;
  }
  return from;
}
function lastOnDay(from: string, d: number): string {
  for (let i = 0; i < 40; i++) {
    const x = shift(from, -i);
    if (dom(x) === d) return x;
  }
  return from;
}

/** Small seeded random generator, so the demo looks the same on every restart. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ITEM_A = 'demo-item-harbor';
const ITEM_B = 'demo-item-cascade';
const CHECKING = 'demo-acct-checking';
const SAVINGS = 'demo-acct-savings';
const REWARDS = 'demo-acct-rewards';
const AUTO = 'demo-acct-auto';
const PROMO = 'demo-acct-promo';
const BROKERAGE = 'demo-acct-brokerage';

type T = { account: string; item: string; name: string; amount: number; cat: string; detail: string; channel?: string };

export async function seedDemo(sql: Sql): Promise<void> {
  const now = new Date().toISOString();
  const t0 = today();
  const env = plaidEnv();

  const items = [
    [ITEM_A, DEMO_USER.email, 'Harbor Credit Union', shift(t0, -400)],
    [ITEM_B, PARTNER, 'Cascade Bank', shift(t0, -380)],
  ];
  for (const [id, owner, name, created] of items) {
    await sql.query(
      `INSERT INTO items (id, owner_email, institution_name, token_enc, plaid_env, status, created_at, last_synced_at, liabilities)
       VALUES ($1,$2,$3,'demo',$4,'ok',$5,$6,'ok')`,
      [id, owner, name, env, created, now],
    );
  }

  const accounts: [string, string, string, string, string, string, number, number | null][] = [
    [CHECKING, ITEM_A, 'Joint Checking', '4821', 'depository', 'checking', 6240.18, 6190.18],
    [SAVINGS, ITEM_A, 'High-Yield Savings', '9034', 'depository', 'savings', 18500, 18500],
    [REWARDS, ITEM_A, 'Everyday Rewards Visa', '1177', 'credit', 'credit card', 1284.55, 8715.45],
    [AUTO, ITEM_A, 'Auto Loan', '5518', 'loan', 'auto', 11420.32, null],
    [PROMO, ITEM_B, 'Balance Transfer Card', '6610', 'credit', 'credit card', 1450, 4550],
    [BROKERAGE, ITEM_B, 'Brokerage', '2290', 'investment', 'brokerage', 42310.77, null],
  ];
  for (const [id, item, name, mask, type, subtype, current, available] of accounts) {
    await sql.query(
      `INSERT INTO accounts (id, item_id, name, mask, type, subtype, current, available, currency, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'USD',$9)`,
      [id, item, name, mask, type, subtype, current, available, now],
    );
  }

  // Card statements: the rewards card is due in a few days, the 0% card later, with its offer ending soon.
  await sql.query(
    `INSERT INTO card_liabilities (account_id, item_id, next_due, minimum, statement_balance, statement_date, last_payment, last_payment_date, is_overdue, updated_at, aprs)
     VALUES ($1,$2,$3,35,1120.40,$4,980,$5,false,$6,$7::jsonb), ($8,$9,$10,35,1450,$11,35,$12,false,$6,$13::jsonb)`,
    [
      REWARDS, ITEM_A, shift(t0, 4), shift(t0, -10), shift(t0, -26), now,
      JSON.stringify([{ type: 'purchase_apr', pct: 24.99, balance: 1284.55, interest: 0 }]),
      PROMO, ITEM_B, shift(t0, 20), shift(t0, -5), shift(t0, -35),
      JSON.stringify([{ type: 'balance_transfer_apr', pct: 0, balance: 1450, interest: 0 }, { type: 'purchase_apr', pct: 27.24, balance: 0, interest: 0 }]),
    ],
  );
  await sql.query(
    `INSERT INTO card_deferrals (id, account_id, kind, label, amount, ends, set_by, updated_at) VALUES
       ('demo-def-bt', $1, 'balance-transfer', '', NULL, $2, $5, $6),
       ('demo-def-laptop', $3, 'deferred', 'Laptop', 600, $4, $5, $6)`,
    [PROMO, shift(t0, 24), REWARDS, shift(t0, 140), DEMO_USER.email, now],
  );

  // About four months of everyday life.
  const rand = rng(20261116);
  const pick = <X>(xs: X[]) => xs[Math.floor(rand() * xs.length)];
  const between = (lo: number, hi: number) => Math.round((lo + rand() * (hi - lo)) * 100) / 100;
  const card = (name: string, amount: number, cat: string, detail: string, channel = 'in store'): T => ({ account: REWARDS, item: ITEM_A, name, amount, cat, detail, channel });
  const bank = (name: string, amount: number, cat: string, detail: string, account = CHECKING): T => ({ account, item: ITEM_A, name, amount, cat, detail, channel: 'other' });
  let n = 0;
  for (let i = -122; i <= 0; i++) {
    const d = shift(t0, i);
    const day = dom(d);
    const out: T[] = [];
    if (day === 1 || day === 15) out.push(bank('Brightline Design Payroll', -2480, 'INCOME', 'INCOME_WAGES'));
    if (dow(d) === 5 && Math.floor((i + 200) / 7) % 2 === 0) out.push(bank('Riverside Health Payroll', -1960, 'INCOME', 'INCOME_WAGES'));
    if (day === 1) {
      out.push(bank('Maple Court Apartments', 2150, 'RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_RENT'));
      out.push(bank('Hope Community Church', 200, 'GOVERNMENT_AND_NON_PROFIT', 'GOVERNMENT_AND_NON_PROFIT_DONATIONS'));
    }
    if (day === 2) {
      out.push(bank('Transfer to Savings', 500, 'TRANSFER_OUT', 'TRANSFER_OUT_SAVINGS'));
      out.push(bank('Transfer from Checking', -500, 'TRANSFER_IN', 'TRANSFER_IN_SAVINGS', SAVINGS));
    }
    if (day === 3) out.push(card('Granite Auto Insurance', 128, 'GENERAL_SERVICES', 'GENERAL_SERVICES_INSURANCE', 'online'));
    if (day === 5) out.push(bank('Harbor CU Auto Loan', 389, 'LOAN_PAYMENTS', 'LOAN_PAYMENTS_CAR_PAYMENT'));
    if (day === 6) out.push(card('Peak Fitness', 49, 'PERSONAL_CARE', 'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS', 'online'));
    if (day === 8) out.push(card('FiberNet Internet', 70, 'RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_INTERNET_AND_CABLE', 'online'));
    if (day === 9) out.push(card('Netflix', 15.49, 'ENTERTAINMENT', 'ENTERTAINMENT_TV_AND_MOVIES', 'online'));
    if (day === 12) out.push(card('City Power & Light', between(84, 126), 'RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY', 'online'));
    if (day === 14) out.push(card('Apple.com/Bill', 12.98, 'ENTERTAINMENT', 'ENTERTAINMENT_TV_AND_MOVIES', 'online'));
    if (day === 17) out.push(card('Spotify', 11.99, 'ENTERTAINMENT', 'ENTERTAINMENT_MUSIC_AND_AUDIO', 'online'));
    if (day === 20) {
      out.push(bank('Payment to Everyday Rewards Visa', 1100, 'LOAN_PAYMENTS', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'));
      out.push(card('Payment received, thank you', -1100, 'LOAN_PAYMENTS', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', 'other'));
    }
    if (day === 22) out.push(card('Northwind Wireless', 85, 'RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_TELEPHONE', 'online'));
    if (dow(d) === 0 || dow(d) === 3) {
      out.push(card(pick(["Trader Joe's", 'Safeway', 'Sprouts Farmers Market']), between(48, 145), 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES'));
    }
    if (dow(d) === 6 && rand() < 0.4) out.push(card('Costco', between(110, 240), 'GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_SUPERSTORES'));
    if (rand() < 0.45) out.push(card(pick(['Chipotle', 'Sweetgreen', 'Luna Taqueria', 'Pho Saigon', 'Slice House Pizza']), between(11, 58), 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_RESTAURANT'));
    // Sam's own card.
    if (rand() < 0.3) out.push({ ...card(pick(['Blue Bottle Coffee', 'Lyft', 'Trader Joe\'s', 'Uniqlo', 'Sweetgreen']), between(6, 70), 'GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES'), account: PROMO, item: ITEM_B });
    if (rand() < 0.35) out.push(card(pick(['Blue Bottle Coffee', 'Starbucks']), between(4.5, 12), 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_COFFEE'));
    if ((i + 200) % 9 === 0) out.push(card(pick(['Shell', 'Chevron']), between(42, 61), 'TRANSPORTATION', 'TRANSPORTATION_GAS'));
    if (rand() < 0.12) out.push(card(pick(['Amazon', 'Target']), between(14, 96), 'GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES', 'online'));
    if (rand() < 0.04) out.push(card(pick(['AMC Theatres', 'City Bookshop', 'REI']), between(18, 85), 'ENTERTAINMENT', 'ENTERTAINMENT_OTHER_ENTERTAINMENT'));

    for (const t of out) {
      await sql.query(
        `INSERT INTO transactions (id, item_id, account_id, date, name, merchant_name, amount, category, category_detail, pending, channel)
         VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10)`,
        [`demo-txn-${++n}`, t.item, t.account, d, t.name, t.amount, t.cat, t.detail, i >= -1 && t.account === REWARDS, t.channel ?? null],
      );
    }
  }

  // What Plaid itself would list as recurring. The app's own rules find the rest (power, internet, phone).
  const streams: [string, string, number, string, number][] = [
    ['Maple Court Apartments', 'monthly', 2150, 'RENT_AND_UTILITIES', 1],
    ['Harbor CU Auto Loan', 'monthly', 389, 'LOAN_PAYMENTS', 5],
    ['Granite Auto Insurance', 'monthly', 128, 'GENERAL_SERVICES', 3],
    ['Peak Fitness', 'monthly', 49, 'PERSONAL_CARE', 6],
    ['Netflix', 'monthly', 15.49, 'ENTERTAINMENT', 9],
    ['Spotify', 'monthly', 11.99, 'ENTERTAINMENT', 17],
  ];
  for (const [name, frequency, amount, category, day] of streams) {
    const account = name === 'Maple Court Apartments' || name === 'Harbor CU Auto Loan' ? CHECKING : REWARDS;
    await sql.query(
      `INSERT INTO recurring (id, item_id, account_id, direction, description, merchant_name, frequency, avg_amount, last_amount, last_date, next_date, status, is_active, category)
       VALUES ($1,$2,$3,'out',$4,$4,$5,$6,$6,$7,$8,'MATURE',true,$9)`,
      [`demo-stream-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`, ITEM_A, account, name, frequency.toUpperCase(), amount, lastOnDay(t0, day), nextOnDay(shift(t0, 1), day), category],
    );
  }
  // Spotify just went up a dollar, and Sam bought a TV two days ago: both show on the Alerts page.
  await sql.query(`UPDATE recurring SET avg_amount = 10.99, last_amount = 11.99 WHERE id = 'demo-stream-spotify'`);
  await sql.query(
    `INSERT INTO transactions (id, item_id, account_id, date, name, merchant_name, amount, category, category_detail, pending, channel)
     VALUES ('demo-txn-tv', $1, $2, $3, 'Best Buy', 'Best Buy', 649.99, 'GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_ELECTRONICS', false, 'in store')`,
    [ITEM_B, PROMO, shift(t0, -2)],
  );

  // Apple subscriptions, as if read from Gmail receipts.
  for (const [key, name, price] of [['icloud', 'iCloud+ (200 GB)', 2.99], ['appletv', 'Apple TV+', 9.99]] as const) {
    await sql.query(
      `INSERT INTO apple_subscriptions (owner_email, key, name, price, months, renews, last_charged, first_seen) VALUES ($1,$2,$3,$4,1,$5,$6,$7)`,
      [DEMO_USER.email, key, name, price, nextOnDay(shift(t0, 1), 14), lastOnDay(t0, 14), shift(t0, -300)],
    );
  }

  // The budget plan.
  const lines: [string, string, 'in' | 'out', number, string, 'fixed' | 'variable', 'need' | 'want' | '', string[]][] = [
    ['Alex paycheck', 'Income', 'in', 2480, 'twice-monthly', 'fixed', '', []],
    ['Sam paycheck', 'Income', 'in', 1960, 'biweekly', 'fixed', '', []],
    ['Church', 'Giving', 'out', 200, 'monthly', 'fixed', 'need', ['m:hope community church']],
    ['Emergency fund', 'Savings', 'out', 500, 'monthly', 'fixed', 'need', ['m:transfer to savings']],
    ['Rent', 'Home', 'out', 2150, 'monthly', 'fixed', 'need', ['m:maple court apartments']],
    ['Power', 'Home', 'out', 110, 'monthly', 'variable', 'need', ['cat:RENT_AND_UTILITIES_GAS_AND_ELECTRICITY']],
    ['Internet', 'Home', 'out', 70, 'monthly', 'fixed', 'need', ['m:fibernet internet']],
    ['Phone', 'Home', 'out', 85, 'monthly', 'fixed', 'need', ['m:northwind wireless']],
    ['Car payment', 'Car', 'out', 389, 'monthly', 'fixed', 'need', ['m:harbor cu auto loan']],
    ['Car insurance', 'Car', 'out', 128, 'monthly', 'fixed', 'need', ['m:granite auto insurance']],
    ['Gas', 'Car', 'out', 180, 'monthly', 'variable', 'need', ['cat:TRANSPORTATION_GAS']],
    ['Groceries', 'Food', 'out', 900, 'monthly', 'variable', 'need', ['cat:FOOD_AND_DRINK_GROCERIES', 'm:costco']],
    ['Eating out', 'Food', 'out', 300, 'monthly', 'variable', 'want', ['cat:FOOD_AND_DRINK']],
    ['Shopping', 'Personal', 'out', 150, 'monthly', 'variable', 'want', ['cat:GENERAL_MERCHANDISE']],
    ['Gym', 'Personal', 'out', 49, 'monthly', 'fixed', 'want', ['m:peak fitness']],
    ['Netflix', 'Subscriptions', 'out', 15.49, 'monthly', 'fixed', 'want', ['m:netflix']],
    ['Spotify', 'Subscriptions', 'out', 11.99, 'monthly', 'fixed', 'want', ['m:spotify']],
    ['Apple', 'Subscriptions', 'out', 12.98, 'monthly', 'fixed', 'want', ['m:apple.com/bill']],
  ];
  let ord = 0;
  for (const [name, grp, direction, amount, frequency, kind, need, match] of lines) {
    await sql.query(
      `INSERT INTO budget_lines (id, name, grp, direction, amount, frequency, kind, need, note, match, ord)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'',$9::jsonb,$10)`,
      [`demo-line-${ord}`, name, grp, direction, amount, frequency, kind, need, JSON.stringify(match), ord++],
    );
  }

  await sql.query(`INSERT INTO people (email, name, updated_at) VALUES ($1, 'Alex Rivera', $3), ($2, 'Sam Rivera', $3)`, [DEMO_USER.email, PARTNER, now]);

  // Never load the real paper worksheet (seed/budget.json) into the demo.
  await setMeta(sql, 'budget_seeded', now);
  await setMeta(sql, 'production_slots_used', '2');
}
