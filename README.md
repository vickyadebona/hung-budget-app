# Budget

A private Rocket Money replacement for two people. Links banks through Plaid, finds recurring charges,
shows upcoming bills and balances.

## Run it on your Mac

```sh
npm install
npm run dev        # http://localhost:4321
```

`.env` is already filled in except for two lines. Copy them from
dashboard.plaid.com > Developers > Keys (use the **Sandbox** secret first):

```
PLAID_CLIENT_ID=...
PLAID_SECRET=...
```

Then open the app, choose "Local dev sign-in", and tap **Add the practice bank in one tap**.
To try the real bank picker in practice mode, tap **Link a bank**, pick any bank, and sign in with
`user_good` / `pass_good`.

## Going to real banks (later, do this once and carefully)

1. In `.env` set `PLAID_ENV=production` and swap `PLAID_SECRET` for the Production secret.
2. Real banks send you to their own site and back, which needs an https address. That means deploying
   to Vercel first, then setting `PLAID_REDIRECT_URI=https://<your-app>.vercel.app/` and adding the same
   address in the Plaid dashboard under Developers > API > Allowed redirect URIs.
3. Each new bank login uses one Trial slot for good. `PLAID_ITEM_CAP` is the hard stop; the app asks you
   to confirm before each one. A broken login is fixed with **Reconnect**, which uses no slot.
4. Keep `TOKEN_KEY` safe (password manager). It unlocks the stored bank tokens; if it is lost, every
   bank must be linked again, using new slots.

## Deploying to Vercel

Set every value from `.env` as an Environment Variable, plus:
- `DATABASE_URL` from a free Neon Postgres database
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, and `AUTH_DEV=0`
- `ALLOWED_EMAILS` with both of your Google emails
- `CRON_SECRET` (enables the daily refresh in `vercel.json`)

## Where things are

| File | What it does |
| --- | --- |
| `src/lib/plaid.ts` | Bank linking, the slot guard, syncing balances / transactions / recurring charges |
| `src/lib/recurring.ts` | Our own rule-based recurring finder (no AI) that catches what Plaid misses |
| `src/lib/budget-rules.ts` | Budget maths: matching, notices, suggestions, CSV reading |
| `src/lib/budget.ts` | Budget storage and the month view |
| `src/lib/summary.ts` | The numbers the home screen shows |
| `src/lib/secrets.ts` | Encrypts bank tokens before they are stored |
| `src/lib/db.ts` | Tables. Local data lives in `./data`; hosted data in Neon |
| `src/components/Dashboard.tsx` | The home screen |

`npm test` runs the recurring-finder and encryption tests. `npm run check` type-checks.

## Budget tab

- The plan is a list of lines (Groceries, Rent, Spotify...) grouped by category. Tap a line to edit it.
- Bank transactions land on a line by rule: merchant name first, then the bank's own category.
  Anything left over appears under **Needs a category**; choose once and that merchant is remembered.
- Notices appear when a line is over, or has $50 or less left (`LOW_LEFT` in `src/lib/budget-rules.ts`).
- **Suggested amounts** pays fixed bills first and scales flexible lines to fit the month's income.
- **Import from a spreadsheet**: upload a .csv in any layout, confirm which column is which, then import.
- **Backup and restore**: download the plan (lines and sorting rules, no bank data) and load it into another copy of the app.
- `seed/budget.json` is the paper worksheet, loaded once on first run. It is not committed to git.

## Not built yet

Reading a Google Sheet directly from Drive, Apple receipt matching from Gmail, bill reminders by email or text.
