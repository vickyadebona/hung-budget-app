import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Summary } from '@/lib/summary';
import { api, money } from './shared';
import { Empty, PageHeader, RefreshButton, Section } from './Section';

const FREQ: Record<string, string> = {
  WEEKLY: 'weekly', BIWEEKLY: 'every 2 weeks', SEMI_MONTHLY: 'twice a month', MONTHLY: 'monthly', ANNUALLY: 'yearly',
  weekly: 'weekly', biweekly: 'every 2 weeks', monthly: 'monthly', quarterly: 'every 3 months', yearly: 'yearly', 'every-6-months': 'every 6 months',
};
const often = (f: string) => FREQ[f] ?? (f.startsWith('every-') ? f.replace(/-/g, ' ') : 'repeats');
const day = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const isYearly = (f: string) => f === 'yearly' || f === 'ANNUALLY';

/**
 * Every repeating charge: from the bank, from our own check, and from Apple and Link emails.
 * You can correct any of them (cancelled, yearly now, not a subscription), and we point out ones that look cancelled.
 */
export default function Recurring({ data, onRefresh, onChanged }: { data: Summary; onRefresh: () => Promise<void>; onChanged?: () => Promise<void> }) {
  const rows = data.recurring;
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const markSub = async (key: string, label: string, mark: string | null) => {
    setBusyKey(`mark:${key}:${mark ?? 'clear'}`);
    setError(null);
    try {
      await api('/api/subscriptions/mark', { key, label, mark });
      await onChanged?.();
      setOpenRow(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that');
    } finally {
      setBusyKey(null);
    }
  };
  const busy = busyKey !== null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 pb-6">
      <PageHeader title="Recurring" subtitle="Subscriptions and bills that repeat">
        <RefreshButton onRefresh={onRefresh} />
      </PageHeader>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Per month</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{money(data.totals.monthlyRecurring)}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Per year</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{money(data.totals.monthlyRecurring * 12)}</p>
        </div>
      </div>

      <Section title="Recurring charges" aside={rows.length ? `${rows.length} found` : undefined}>
        {rows.length === 0 ? <Empty>Link a bank and recurring charges will show up here.</Empty> : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id} className="py-2.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{r.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {often(r.frequency)}
                      {isYearly(r.frequency) && ` (${money(r.monthly)}/mo)`}
                      {r.nextDate && ` · next ${day(r.nextDate)}`}
                      {r.source === 'found' && ' · spotted by our own check'}
                      {r.source === 'apple' && ' · from Apple receipts'}
                      {r.source === 'link' && ' · from Link emails'}
                      {'trial' in r && r.trial && ' · free trial'}
                      {r.priceChanged && ' · price changed'}
                      {r.switchedToYearly && ' · looks switched to yearly'}
                      {r.mark === 'yearly' && ' · you marked yearly'}
                    </p>
                  </div>
                  <span className="tabular-nums">{money(r.amount)}</span>
                  <Button variant="ghost" size="icon-sm" aria-label={`Change ${r.label}`} aria-expanded={openRow === r.key}
                    onClick={() => setOpenRow(openRow === r.key ? null : r.key)}><MoreHorizontal /></Button>
                </div>
                {openRow === r.key && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {([
                      ['cancelled', 'I cancelled it'],
                      [isYearly(r.frequency) ? 'monthly' : 'yearly', isYearly(r.frequency) ? "It's monthly" : "It's yearly now"],
                      ['not-subscription', 'Not a subscription'],
                    ] as [string, string][]).map(([m, label]) => (
                      <Button key={m} size="sm" variant="outline" disabled={busy} loading={busyKey === `mark:${r.key}:${m}`}
                        onClick={() => markSub(r.key, r.label, m)}>{label}</Button>
                    ))}
                    {r.mark && (
                      <Button size="sm" variant="ghost" disabled={busy} loading={busyKey === `mark:${r.key}:clear`}
                        onClick={() => markSub(r.key, r.label, null)}>Undo my change</Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {data.possiblyCancelled.length > 0 && (
        <Section title="Possibly cancelled" aside={`${money(data.possiblyCancelled.reduce((n, r) => n + r.monthly, 0))}/mo`}>
          <p className="mb-2 text-xs text-muted-foreground">These stopped charging when they were due. They're left out of your totals until you say which.</p>
          <ul className="divide-y">
            {data.possiblyCancelled.map((r) => (
              <li key={r.id} className="py-2.5 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate font-medium">{r.label}</span>
                  <span className="tabular-nums">{money(r.amount)}</span>
                </div>
                <p className="text-xs text-muted-foreground">{often(r.frequency)} · last charged {r.lastDate ? day(r.lastDate) : 'a while ago'}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={busy} loading={busyKey === `mark:${r.key}:cancelled`} onClick={() => markSub(r.key, r.label, 'cancelled')}>Yes, cancelled</Button>
                  <Button size="sm" variant="ghost" disabled={busy} loading={busyKey === `mark:${r.key}:active`} onClick={() => markSub(r.key, r.label, 'active')}>Still active</Button>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {data.stopped.length > 0 && (
        <details className="rounded-2xl border bg-card p-4 text-card-foreground">
          <summary className="cursor-pointer text-sm font-semibold">
            Cancelled and hidden <span className="font-normal text-muted-foreground">({data.stopped.length} · {money(data.stopped.filter((r) => r.status === 'cancelled').reduce((n, r) => n + r.monthly, 0))}/mo saved)</span>
          </summary>
          <ul className="mt-2 divide-y">
            {data.stopped.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{r.label}</span>
                  <span className="block text-xs text-muted-foreground">{r.status === 'cancelled' ? 'cancelled' : 'not a subscription'} · {money(r.amount)} {FREQ[r.frequency] ?? ''}</span>
                </span>
                <Button size="sm" variant="ghost" disabled={busy} loading={busyKey === `mark:${r.key}:clear`} onClick={() => markSub(r.key, r.label, null)}>Undo</Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
