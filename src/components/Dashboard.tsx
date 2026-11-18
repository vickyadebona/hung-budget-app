import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Landmark, MoreHorizontal, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Summary } from '@/lib/summary';
import { APR_LABEL, DEFERRAL_KINDS, DEFERRAL_LABEL, type Apr, type AprType, type DeferralKind, type DeferralPlan, type DeferralSummary } from '@/lib/cards';
import type { Notice } from '@/lib/budget-rules';
import { Notices } from './Budget';
import { api, money } from './shared';
import { Empty, PageHeader, Section } from './Section';

declare global {
  interface Window {
    Plaid?: { create(config: Record<string, unknown>): { open(): void; destroy(): void } };
  }
}

const day = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', d.slice(0, 4) === String(new Date().getFullYear()) ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
const LINK_KEY = 'bud_link_token';

// Kept in localStorage (not sessionStorage) because a bank's own app can send you back in a new tab.
// Link tokens expire after 4 hours, so an old one is ignored.
type LinkMode = { itemId?: string; consent?: 'liabilities' };
function rememberToken(token: string, mode: LinkMode = {}) {
  try { localStorage.setItem(LINK_KEY, JSON.stringify({ token, mode, at: Date.now() })); } catch { /* private mode */ }
}
function recallToken(): { token: string; mode: LinkMode } | null {
  try {
    const v = JSON.parse(localStorage.getItem(LINK_KEY) ?? 'null');
    return v && typeof v.token === 'string' && Date.now() - v.at < 3.5 * 3600_000 ? { token: v.token, mode: v.mode ?? {} } : null;
  } catch { return null; }
}
function forgetToken() {
  try { localStorage.removeItem(LINK_KEY); } catch { /* private mode */ }
}

function loadPlaid(): Promise<void> {
  if (window.Plaid) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the bank picker. Check your connection.'));
    document.head.appendChild(s);
  });
}


type Account = Summary['accounts'][number];
type Card = Summary['cards'][number];

function AccountList({ accounts, bankName }: { accounts: Account[]; bankName: (itemId: string) => string }) {
  return (
    <ul className="divide-y">
      {accounts.map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            <span className="block truncate">{a.name}{a.mask && <span className="text-muted-foreground"> ··{a.mask}</span>}</span>
            <span className="block truncate text-xs text-muted-foreground">{bankName(a.item_id)}{a.shared && ' · shared'}</span>
          </span>
          <span className="tabular-nums">{a.current == null ? '—' : money(a.current)}</span>
        </li>
      ))}
    </ul>
  );
}

const longDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', d.slice(0, 4) === String(new Date().getFullYear()) ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
const inDays = (n: number | null) => (n === null ? '' : n === 0 ? ' (today)' : n === 1 ? ' (tomorrow)' : n > 1 ? ` (in ${n} days)` : '');

function cardLine(c: Card): string {
  const d = c.details;
  switch (c.state) {
    case 'overdue': return d?.next_due ? `Payment overdue: ${money(d.minimum ?? 0)} minimum was due ${longDay(d.next_due)}` : 'Payment overdue';
    case 'due-soon':
    case 'due': return `${money(d!.minimum ?? 0)} minimum due ${longDay(d!.next_due!)}${inDays(c.daysLeft)}${d!.statement_balance != null ? ` · statement ${money(d!.statement_balance)}` : ''}`;
    case 'paid': return `Paid ${money(d!.last_payment ?? 0)} on ${longDay(d!.last_payment_date!)}${d!.next_due ? ` · next due ${longDay(d!.next_due)}` : ''}`;
    case 'nothing-due': return 'No payment due';
    default: return 'Due date not shared yet';
  }
}

/** "0% on $2,400 (balance transfer) · 24.99% on purchases · $6.20 interest last statement" */
function rateLine(c: Card): string {
  const parts: string[] = [];
  for (const a of c.zeroAprs) parts.push(`0% on ${a.balance != null ? money(a.balance) : 'part of the balance'} (${APR_LABEL[a.type as AprType]})`);
  for (const a of c.aprs) {
    if (a.pct === 0) continue;
    if (a.type === 'cash_apr' && !(a.balance && a.balance > 0)) continue; // cash rate only matters if there is a cash balance
    parts.push(`${a.pct}% on ${APR_LABEL[a.type as AprType]}`);
  }
  if (c.interestLastStatement && c.interestLastStatement > 0) parts.push(`${money(c.interestLastStatement)} interest last statement`);
  return parts.join(' · ');
}

const field = 'h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

type Plan = DeferralPlan;
type Draft = { id?: string; kind: DeferralKind; label: string; amount: string; ends: string };
export type DeferralSave = { id?: string; accountId: string; kind: DeferralKind; label: string; amount: number | null; ends: string };

const planName = (p: { kind: DeferralKind; label: string }) => p.label || DEFERRAL_LABEL[p.kind];

/** "$3,000 · ends Thu, Mar 1 (in 104 days) · pay $750/mo" */
function planLine(p: Plan): string {
  const amount = `${money(p.balance)}${p.amount === null ? ' (what the bank shows at 0%)' : ''}`;
  if (p.level === 'ended') {
    return `${amount} · ended ${longDay(p.ends)} · ${p.kind === 'deferred' ? 'interest may be added back if unpaid' : 'now charged interest'}`;
  }
  return `${amount} · ends ${longDay(p.ends)}${inDays(p.daysLeft)}${p.monthly != null ? ` · pay ${money(p.monthly)}/mo` : ''}`;
}

/**
 * The 0% and deferred-interest parts of one card's balance, each with its own end date and monthly payoff.
 * Offered on every credit card: banks rarely say when an offer ends, so these are typed in.
 */
function Deferrals({ card, busy, savingKey, onSave, onRemove }: {
  card: Card; busy: boolean; savingKey: string | null;
  onSave: (d: DeferralSave) => void; onRemove: (id: string) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const { plans, rest, overBalance } = card.deferrals as DeferralSummary;
  const bt = (card.zeroAprs as Apr[]).find((z) => z.type === 'balance_transfer_apr');
  const bankZero = card.zeroBalance as number | null;
  const open = (p?: Plan) => setDraft(p
    ? { id: p.id, kind: p.kind, label: p.label, amount: p.amount == null ? '' : String(p.amount), ends: p.ends }
    : { kind: bt ? 'balance-transfer' : 'deferred', label: '', amount: '', ends: '' });
  const tone = (p: Plan) => p.level === 'ended' || p.level === 'urgent' ? 'text-destructive' : p.level === 'soon' ? 'font-medium text-warn-foreground' : 'text-muted-foreground';

  return (
    <div className="mt-1 grid gap-1">
      {plans.length > 0 && (
        <ul className="grid gap-1">
          {plans.map((p) => (
            <li key={p.id} className={`text-xs ${tone(p)}`}>
              <span className="font-medium">{planName(p)}</span>: {planLine(p)}{' '}
              <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => open(p)}>Change</button>
            </li>
          ))}
        </ul>
      )}
      {plans.length > 0 && rest != null && rest > 0 && <p className="text-xs text-muted-foreground">Rest of the balance, at the normal rate: {money(rest)}</p>}
      {overBalance && <p className="text-xs text-warn-foreground">These add up to more than the card balance. Lower the amounts as you pay them down.</p>}

      {draft ? (
        <form className="mt-1 grid gap-2 rounded-xl border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.ends) return;
            onSave({ id: draft.id, accountId: card.id, kind: draft.kind, label: draft.label, amount: draft.amount.trim() ? Number(draft.amount) : null, ends: draft.ends });
            setDraft(null);
          }}>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-muted-foreground">
              Kind
              <select className={field} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as DeferralKind })}>
                {DEFERRAL_KINDS.map((k) => <option key={k} value={k}>{DEFERRAL_LABEL[k]}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              Name (optional)
              <input className={field} value={draft.label} maxLength={60} placeholder={draft.kind === 'deferred' ? 'e.g. Couch' : 'e.g. From the old Visa'}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              Amount
              <input className={field} inputMode="decimal" value={draft.amount}
                placeholder={bankZero != null ? `Leave blank for ${money(bankZero)} (bank's 0% figure)` : 'Leave blank for the whole balance'}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value.replace(/[^0-9.]/g, '') })} />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              {draft.kind === 'deferred' ? 'Pay off by' : '0% ends'}
              <input className={field} type="date" value={draft.ends} required onChange={(e) => setDraft({ ...draft, ends: e.target.value })} />
            </label>
          </div>
          {draft.kind === 'deferred' && (
            <p className="text-xs text-muted-foreground">With deferred interest, anything left after this date can be charged all the interest from the start.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="submit" disabled={busy || !draft.ends} loading={savingKey === `deferral:${card.id}`}>Save</Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            {draft.id && (
              <Button size="sm" type="button" variant="ghost" className="text-destructive" disabled={busy}
                onClick={() => { onRemove(draft.id!); setDraft(null); }}>Remove</Button>
            )}
          </div>
        </form>
      ) : (
        <button type="button" className="justify-self-start text-xs text-primary underline-offset-4 hover:underline" onClick={() => open()}>
          {plans.length > 0
            ? '+ Add another 0% or deferred amount'
            : bt ? `Your bank shows ${bt.balance != null ? money(bt.balance) : 'a balance'} at 0% (balance transfer). Add when it ends`
            : '+ Add a 0% offer, balance transfer or deferred amount'}
        </button>
      )}
    </div>
  );
}


export default function Dashboard({ initial, userName, userEmail, demo = false, notices = [], onOpenBudget, onOpenRecurring, onSummary, latest }: {
  initial: Summary; userName: string; userEmail: string; demo?: boolean; notices?: Notice[];
  onOpenBudget?: () => void; onOpenRecurring?: () => void; onSummary?: (s: Summary) => void; latest?: Summary | null;
}) {
  const [data, setData] = useState(initial);
  useEffect(() => { onSummary?.(data); }, [data, onSummary]); // the Recurring page shows the same, freshest data
  useEffect(() => { if (latest) setData(latest); }, [latest]); // ...and a refresh from another page shows here too
  const [busy, setBusy] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null); // which button started the current action
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const handler = useRef<{ open(): void; destroy(): void } | null>(null);

  const refresh = useCallback(async () => setData(await api<Summary>('/api/summary')), []);

  // Fix a charge in the "Coming up" list: it was cancelled, it is yearly now, or it is not a subscription.
  const [openUp, setOpenUp] = useState<string | null>(null);

  const run = useCallback(async (label: string, fn: () => Promise<void>, key: string | null = null) => {
    setBusy(label);
    setBusyKey(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(null);
      setBusyKey(null);
    }
  }, []);

  const markUpcoming = (key: string, label: string, mark: string | null) =>
    run('Saving your change', async () => {
      await api('/api/subscriptions/mark', { key, label, mark });
      await refresh();
      setOpenUp(null);
    }, `mark:${key}:${mark ?? 'clear'}`);

  const openLink = useCallback(async (linkToken: string, mode: LinkMode, receivedRedirectUri?: string) => {
    await loadPlaid();
    handler.current?.destroy();
    handler.current = window.Plaid!.create({
      token: linkToken,
      receivedRedirectUri,
      onSuccess: (publicToken: string, meta: { institution?: { name?: string } }) => {
        forgetToken();
        void run(mode.itemId ? 'Refreshing your bank' : 'Saving your bank', async () => {
          // Reopening an existing login keeps the same saved login: nothing to exchange, just refresh.
          if (mode.itemId) await api('/api/plaid/updated', { itemId: mode.itemId, consent: mode.consent });
          else await api('/api/plaid/exchange', { publicToken, institutionName: meta?.institution?.name });
          await refresh();
        }, mode.itemId ? `${mode.consent ?? 'fix'}:${mode.itemId}` : 'link');
      },
      onExit: (err: { error_code?: string; error_message?: string; display_message?: string } | null, meta: unknown) => {
        forgetToken();
        if (!err) return; // closed by choice
        void fetch('/api/plaid/link-event', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ event: 'exit', error: err, metadata: meta }),
        }).catch(() => {});
        setError(`${err.display_message || err.error_message || 'The bank sign-in stopped with an error.'}${err.error_code ? ` (${err.error_code})` : ''}`);
      },
    });
    handler.current!.open();
  }, [refresh, run]);

  // Banks like Bank of America send you to their own site and back; pick the flow up again on return.
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('oauth_state_id')) return;
    const saved = recallToken();
    const href = location.href;
    history.replaceState(null, '', location.pathname);
    if (saved) void run('Finishing bank sign-in', () => openLink(saved.token, saved.mode, href), saved.mode.itemId ? `${saved.mode.consent ?? 'fix'}:${saved.mode.itemId}` : 'link');
    else setError('The bank sign-in could not be picked up again in this browser. Nothing was linked and no slot was used. Tap Link a bank to retry.');
  }, [openLink, run]);

  const connect = (itemId?: string, consent?: 'liabilities') =>
    run('Opening bank picker', async () => {
      const mode: LinkMode = itemId ? { itemId, consent } : {};
      const { linkToken } = await api<{ linkToken: string }>('/api/plaid/link-token', mode);
      rememberToken(linkToken, mode);
      await openLink(linkToken, mode);
      setConfirming(false);
    }, itemId ? `${consent ?? 'fix'}:${itemId}` : 'link');

  const real = data.env === 'production';
  const slotsLeft = data.slots.cap - data.slots.used;
  const bankName = (itemId: string) => data.items.find((i) => i.id === itemId)?.name ?? '';
  const total = (xs: { current: number | null }[]) => xs.reduce((n, a) => n + (a.current ?? 0), 0);
  const consentItems = data.items.filter((i) => i.liabilities === 'consent');

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 pb-6">
      <PageHeader title="Overview" subtitle={`Hi ${userName.split(' ')[0]}`}>
          <Button variant="outline" size="lg" disabled={!!busy || data.items.length === 0} loading={busyKey === 'refresh'}
            onClick={() => run('Refreshing', async () => { await api('/api/sync', {}); await refresh(); }, 'refresh')}>
            <RefreshCw /> Refresh
          </Button>
      </PageHeader>

      {!real && !demo && (
        <p className="rounded-xl bg-warn px-3 py-2 text-sm text-warn-foreground">
          Practice mode: these are Plaid's fake banks, so nothing here is your real money.
        </p>
      )}
      {!data.configured && !demo && (
        <p className="rounded-xl border px-3 py-2 text-sm">
          Plaid keys are missing. Add <code>PLAID_CLIENT_ID</code> and <code>PLAID_SECRET</code> to <code>.env</code>, then restart.
        </p>
      )}
      {error && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {busy && <p className="text-sm text-muted-foreground" aria-live="polite">{busy}…</p>}
      {data.cardNotices.length > 0 && (
        <ul className="grid gap-2" aria-label="Card payments due">
          {data.cardNotices.map((n) => (
            <li key={n.accountId} className={`rounded-xl px-3 py-2 text-sm ${n.state === 'overdue' ? 'bg-destructive/10 text-destructive' : 'bg-warn text-warn-foreground'}`}>
              <span className="font-medium">{n.name}</span>
              {n.state === 'overdue'
                ? `: payment overdue${n.minimum != null ? `, ${money(n.minimum)} minimum` : ''}`
                : `: ${n.minimum != null ? money(n.minimum) + ' minimum' : 'payment'} due ${n.due ? longDay(n.due) : ''}${inDays(n.daysLeft)}`}
            </li>
          ))}
        </ul>
      )}
      {data.promoNotices.length > 0 && (
        <ul className="grid gap-2" aria-label="0% offers ending">
          {data.promoNotices.map((n) => (
            <li key={n.id} className={`rounded-xl px-3 py-2 text-sm ${n.level === 'soon' ? 'bg-warn text-warn-foreground' : 'bg-destructive/10 text-destructive'}`}>
              <span className="font-medium">{n.name}</span> ({planName(n)})
              {n.level === 'ended'
                ? `: ended ${longDay(n.ends)}, ${money(n.balance)} ${n.kind === 'deferred' ? 'may have interest added back' : 'may now be charged interest'}`
                : `: ${n.kind === 'deferred' ? 'pay off by' : '0% ends'} ${longDay(n.ends)}${inDays(n.daysLeft)}. Pay ${money(n.monthly ?? n.balance)}/mo to clear ${money(n.balance)}`}
            </li>
          ))}
        </ul>
      )}
      <Notices notices={notices} onOpen={onOpenBudget} />

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Net balance</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{money(data.totals.net)}</p>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">{money(data.totals.assets)} cash · {money(data.totals.debts)} owed</p>
        </div>
        <button type="button" onClick={onOpenRecurring}
          className="rounded-2xl border bg-card p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <p className="text-xs text-muted-foreground">Recurring per month</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{money(data.totals.monthlyRecurring)}</p>
          <p className="mt-1 text-xs text-primary">{data.recurring.length} charges · see all</p>
        </button>
      </div>

      {data.cardDue.length > 0 && (
        <Section title="Card payments due" aside={`${money(data.cardDue.reduce((n, c) => n + c.minimum, 0))} in minimums`}>
          <ul className="divide-y">
            {data.cardDue.map((c) => (
              <li key={c.accountId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className={`text-xs ${c.state === 'overdue' ? 'text-destructive' : c.state === 'due-soon' ? 'font-medium text-warn-foreground' : 'text-muted-foreground'}`}>
                    {c.state === 'overdue' ? `Overdue since ${longDay(c.due)}` : `Due ${longDay(c.due)}${inDays(c.daysLeft)}`}
                    {c.statement != null && <span className="font-normal text-muted-foreground"> · statement {money(c.statement)}</span>}
                    <span className="font-normal text-muted-foreground"> · {c.bank}</span>
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="tabular-nums">{money(c.minimum)}</p>
                  <p className="text-xs text-muted-foreground">minimum</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Coming up in the next 30 days" aside={data.upcoming.length ? money(data.upcoming.reduce((n, r) => n + r.amount, 0)) : undefined}>
        {data.upcoming.length === 0 ? <Empty>Nothing predicted yet.</Empty> : (
          <ul className="divide-y">
            {data.upcoming.map((r) => (
              <li key={r.id} className="py-1.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-14 shrink-0 text-muted-foreground">{day(r.nextDate!)}</span>
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  <span className="tabular-nums">{money(r.amount)}</span>
                  <Button variant="ghost" size="icon-sm" aria-label={`Fix ${r.label}`} aria-expanded={openUp === r.key}
                    onClick={() => setOpenUp(openUp === r.key ? null : r.key)}><MoreHorizontal /></Button>
                </div>
                {openUp === r.key && (
                  <div className="mt-1.5 flex flex-wrap gap-2 pb-1">
                    {([
                      ['cancelled', 'I cancelled it'],
                      ['yearly', "It's yearly now"],
                      ['not-subscription', 'Not a subscription'],
                    ] as [string, string][]).filter(([m]) => m !== 'yearly' || (r.frequency !== 'yearly' && r.frequency !== 'ANNUALLY')).map(([m, label]) => (
                      <Button key={m} size="sm" variant="outline" disabled={!!busy} loading={busyKey === `mark:${r.key}:${m}`}
                        onClick={() => markUpcoming(r.key, r.label, m)}>{label}</Button>
                    ))}
                    {r.mark && (
                      <Button size="sm" variant="ghost" disabled={!!busy} loading={busyKey === `mark:${r.key}:clear`}
                        onClick={() => markUpcoming(r.key, r.label, null)}>Undo my change</Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setOpenUp(null)}>Close</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Bank balances" aside={data.bank.length ? money(total(data.bank)) : undefined}>
        {data.bank.length === 0 ? <Empty>No checking or savings accounts linked yet.</Empty> : (
          <AccountList accounts={data.bank} bankName={bankName} />
        )}
      </Section>

      <Section title="Credit cards" aside={data.cards.length ? `${money(total(data.cards))} owed` : undefined}>
        {data.cards.length === 0 ? <Empty>No credit cards linked yet.</Empty> : (
          <ul className="divide-y">
            {data.cards.map((c) => (
              <li key={c.id} className="py-2.5 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="truncate font-medium">{c.name}{c.mask && <span className="font-normal text-muted-foreground"> ··{c.mask}</span>}</span>
                    {(c.zeroAprs.length > 0 || (c.deferrals.plans as Plan[]).some((p) => p.kind !== 'deferred')) && (
                      <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">0% APR</span>
                    )}
                    {(c.deferrals.plans as Plan[]).some((p) => p.kind === 'deferred') && (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Deferred</span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums">{c.current == null ? '—' : money(c.current)}</span>
                </div>
                <p className={`text-xs ${c.state === 'overdue' ? 'text-destructive' : c.state === 'due-soon' ? 'font-medium text-warn-foreground' : 'text-muted-foreground'}`}>
                  {cardLine(c)}
                  <span className="text-muted-foreground"> · {bankName(c.item_id)}{c.shared && ' · shared'}</span>
                </p>
                {rateLine(c) && <p className="text-xs text-muted-foreground">{rateLine(c)}</p>}
                <Deferrals card={c} busy={!!busy} savingKey={busyKey}
                  onSave={(d) => run('Saving', async () => { await api('/api/cards/deferral', d); await refresh(); }, `deferral:${c.id}`)}
                  onRemove={(id) => run('Removing', async () => { await api('/api/cards/deferral', { id, delete: true }); await refresh(); }, `deferral:${c.id}`)} />
              </li>
            ))}
          </ul>
        )}
        {consentItems.map((it) => (
          <div key={it.id} className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-muted px-3 py-2 text-sm">
            <span>{it.name} needs your OK to share card due dates.</span>
            <Button size="sm" variant="outline" disabled={!!busy || it.owner !== userEmail} loading={busyKey === `liabilities:${it.id}`} onClick={() => connect(it.id, 'liabilities')}
              title={it.owner !== userEmail ? `Only ${it.owner} can allow this` : undefined}>Allow</Button>
          </div>
        ))}
      </Section>

      {data.investments.length > 0 && (
        <Section title="Investments" aside={money(total(data.investments))}>
          <AccountList accounts={data.investments} bankName={bankName} />
        </Section>
      )}

      {data.loans.length > 0 && (
        <Section title="Loans" aside={`${money(total(data.loans))} owed`}>
          <AccountList accounts={data.loans} bankName={bankName} />
        </Section>
      )}

      <Section title="Linked banks" aside={real && !demo ? `${slotsLeft} of ${data.slots.cap} logins left` : undefined}>
        {data.items.length === 0 && <Empty>No banks linked yet.</Empty>}
        <ul className="divide-y">
          {data.items.map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium"><Landmark className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{it.name}</span></p>
                <p className="text-xs text-muted-foreground">
                  Linked by {it.owner}{it.lastSynced && ` · updated ${new Date(it.lastSynced).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
                </p>
              </div>
              {it.status !== 'ok' && (
                <Button variant="outline" size="sm" disabled={!!busy} loading={busyKey === `fix:${it.id}`} onClick={() => connect(it.id)}>
                  <AlertTriangle /> {it.status === 'reconnect' ? 'Reconnect' : 'Fix'}
                </Button>
              )}
            </li>
          ))}
        </ul>

        {!demo && <div className="mt-4 grid gap-2">
          {real && confirming ? (
            <div className="rounded-xl border p-3 text-sm">
              <p>This uses 1 of your {slotsLeft} remaining bank logins, and it can't be undone.
                {data.items.length > 0 && ` Already linked: ${data.items.map((i) => i.name).join(', ')}.`} Use “Reconnect” to fix an existing bank instead.</p>
              <div className="mt-3 flex gap-2">
                <Button size="lg" disabled={!!busy} loading={busyKey === 'link'} onClick={() => connect()}>Yes, link a new bank</Button>
                <Button size="lg" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button size="lg" disabled={!!busy || !data.configured || (real && slotsLeft <= 0)} loading={busyKey === 'link'}
              onClick={() => (real ? setConfirming(true) : connect())}>
              <Plus /> Link a bank
            </Button>
          )}
          {!real && (
            <Button size="lg" variant="outline" disabled={!!busy || !data.configured} loading={busyKey === 'practice'}
              onClick={() => run('Linking the practice bank', async () => { await api('/api/plaid/sandbox-connect', {}); await refresh(); }, 'practice')}>
              Add the practice bank in one tap
            </Button>
          )}
        </div>}
      </Section>
    </div>
  );
}
