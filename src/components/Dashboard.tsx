import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Landmark, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Summary } from '@/lib/summary';
import type { Notice } from '@/lib/budget-rules';
import { Notices } from './Budget';
import { api, money } from './shared';

declare global {
  interface Window {
    Plaid?: { create(config: Record<string, unknown>): { open(): void; destroy(): void } };
  }
}

const day = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const FREQ: Record<string, string> = {
  WEEKLY: 'weekly', BIWEEKLY: 'every 2 weeks', SEMI_MONTHLY: 'twice a month', MONTHLY: 'monthly', ANNUALLY: 'yearly',
  weekly: 'weekly', biweekly: 'every 2 weeks', monthly: 'monthly', quarterly: 'every 3 months', yearly: 'yearly',
};
const LINK_KEY = 'bud_link_token';

// Kept in localStorage (not sessionStorage) because a bank's own app can send you back in a new tab.
// Link tokens expire after 4 hours, so an old one is ignored.
function rememberToken(token: string) {
  try { localStorage.setItem(LINK_KEY, JSON.stringify({ token, at: Date.now() })); } catch { /* private mode */ }
}
function recallToken(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(LINK_KEY) ?? 'null');
    return v && typeof v.token === 'string' && Date.now() - v.at < 3.5 * 3600_000 ? v.token : null;
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

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-4 text-card-foreground">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside && <span className="text-sm text-muted-foreground tabular-nums">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;

export default function Dashboard({ initial, userName, notices = [], onOpenBudget }: {
  initial: Summary; userName: string; notices?: Notice[]; onOpenBudget?: () => void;
}) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const handler = useRef<{ open(): void; destroy(): void } | null>(null);

  const refresh = useCallback(async () => setData(await api<Summary>('/api/summary')), []);

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }, []);

  const openLink = useCallback(async (linkToken: string, receivedRedirectUri?: string) => {
    await loadPlaid();
    handler.current?.destroy();
    handler.current = window.Plaid!.create({
      token: linkToken,
      receivedRedirectUri,
      onSuccess: (publicToken: string, meta: { institution?: { name?: string } }) => {
        forgetToken();
        void run('Saving your bank', async () => {
          await api('/api/plaid/exchange', { publicToken, institutionName: meta?.institution?.name });
          await refresh();
        });
      },
      onExit: () => forgetToken(),
    });
    handler.current!.open();
  }, [refresh, run]);

  // Banks like Bank of America send you to their own site and back; pick the flow up again on return.
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('oauth_state_id')) return;
    const saved = recallToken();
    const href = location.href;
    history.replaceState(null, '', location.pathname);
    if (saved) void run('Finishing bank sign-in', () => openLink(saved, href));
    else setError('The bank sign-in could not be picked up again in this browser. Nothing was linked and no slot was used. Tap Link a bank to retry.');
  }, [openLink, run]);

  const connect = (itemId?: string) =>
    run('Opening bank picker', async () => {
      setConfirming(false);
      const { linkToken } = await api<{ linkToken: string }>('/api/plaid/link-token', itemId ? { itemId } : {});
      rememberToken(linkToken);
      await openLink(linkToken);
    });

  const real = data.env === 'production';
  const slotsLeft = data.slots.cap - data.slots.used;
  const byItem = (id: string) => data.accounts.filter((a) => a.item_id === id);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 pb-6">
      <header className="flex items-center justify-between gap-3 pt-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Budget</h1>
          <p className="text-sm text-muted-foreground">Hi {userName.split(' ')[0]}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="lg" disabled={!!busy || data.items.length === 0}
            onClick={() => run('Refreshing', async () => { await api('/api/sync', {}); await refresh(); })}>
            <RefreshCw className={busy === 'Refreshing' ? 'animate-spin' : ''} /> Refresh
          </Button>
          <form method="post" action="/auth/logout"><Button variant="ghost" size="lg" type="submit">Sign out</Button></form>
        </div>
      </header>

      {!real && (
        <p className="rounded-xl bg-warn px-3 py-2 text-sm text-warn-foreground">
          Practice mode: these are Plaid's fake banks, so nothing here is your real money.
        </p>
      )}
      {!data.configured && (
        <p className="rounded-xl border px-3 py-2 text-sm">
          Plaid keys are missing. Add <code>PLAID_CLIENT_ID</code> and <code>PLAID_SECRET</code> to <code>.env</code>, then restart.
        </p>
      )}
      {error && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {busy && <p className="text-sm text-muted-foreground" aria-live="polite">{busy}…</p>}
      <Notices notices={notices} onOpen={onOpenBudget} />

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Net balance</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{money(data.totals.net)}</p>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">{money(data.totals.assets)} cash · {money(data.totals.debts)} owed</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Recurring per month</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{money(data.totals.monthlyRecurring)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{data.recurring.length} charges found</p>
        </div>
      </div>

      <Section title="Coming up in the next 30 days" aside={data.upcoming.length ? money(data.upcoming.reduce((n, r) => n + r.amount, 0)) : undefined}>
        {data.upcoming.length === 0 ? <Empty>Nothing predicted yet.</Empty> : (
          <ul className="divide-y">
            {data.upcoming.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="w-14 shrink-0 text-muted-foreground">{day(r.nextDate!)}</span>
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                <span className="tabular-nums">{money(r.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Recurring charges" aside={data.recurring.length ? `${money(data.totals.monthlyRecurring * 12)} a year` : undefined}>
        {data.recurring.length === 0 ? <Empty>Link a bank and recurring charges will show up here.</Empty> : (
          <ul className="divide-y">
            {data.recurring.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {FREQ[r.frequency] ?? 'repeats'}
                    {r.source === 'found' && ' · spotted by our own check'}
                    {r.priceChanged && ' · price changed'}
                  </p>
                </div>
                <span className="tabular-nums">{money(r.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Accounts" aside={real ? `${slotsLeft} of ${data.slots.cap} bank logins left` : undefined}>
        {data.items.length === 0 && <Empty>No banks linked yet.</Empty>}
        <div className="grid gap-4">
          {data.items.map((it) => (
            <div key={it.id}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-medium"><Landmark className="size-4 text-muted-foreground" />{it.name}</p>
                {it.status !== 'ok' && (
                  <Button variant="outline" size="sm" disabled={!!busy} onClick={() => connect(it.id)}>
                    <AlertTriangle /> {it.status === 'reconnect' ? 'Reconnect' : 'Fix'}
                  </Button>
                )}
              </div>
              <ul className="divide-y">
                {byItem(it.id).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{a.name}{a.mask && <span className="text-muted-foreground"> ··{a.mask}</span>}</span>
                    <span className="tabular-nums">{a.current == null ? '—' : money(a.current)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">
                Linked by {it.owner}{it.lastSynced && ` · updated ${new Date(it.lastSynced).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-2">
          {real && confirming ? (
            <div className="rounded-xl border p-3 text-sm">
              <p>This uses 1 of your {slotsLeft} remaining bank logins, and it can't be undone.
                {data.items.length > 0 && ` Already linked: ${data.items.map((i) => i.name).join(', ')}.`} Use “Reconnect” to fix an existing bank instead.</p>
              <div className="mt-3 flex gap-2">
                <Button size="lg" disabled={!!busy} onClick={() => connect()}>Yes, link a new bank</Button>
                <Button size="lg" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button size="lg" disabled={!!busy || !data.configured || (real && slotsLeft <= 0)}
              onClick={() => (real ? setConfirming(true) : connect())}>
              <Plus /> Link a bank
            </Button>
          )}
          {!real && (
            <Button size="lg" variant="outline" disabled={!!busy || !data.configured}
              onClick={() => run('Linking the practice bank', async () => { await api('/api/plaid/sandbox-connect', {}); await refresh(); })}>
              Add the practice bank in one tap
            </Button>
          )}
        </div>
      </Section>
    </div>
  );
}
