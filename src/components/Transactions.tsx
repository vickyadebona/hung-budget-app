import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { shiftMonth } from '@/lib/budget-rules';
import type { Transactions as TxnData } from '@/lib/transactions';
import { api, money } from './shared';
import { Empty, PageHeader, RefreshButton, Section } from './Section';

const thisMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
const monthName = (m: string) => new Date(m + '-15T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const dayHeading = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const category = (c: string | null) => (c ? c.charAt(0) + c.slice(1).toLowerCase().replace(/_/g, ' ') : null);

/** Recent transactions for one month (this month to start), newest first, grouped by day. */
export default function Transactions({ active, onSync }: { active: boolean; onSync: () => Promise<void> }) {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<TxnData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async (m: string) => {
    setLoading(true);
    setError(null);
    try {
      setData(await api<TxnData>(`/api/transactions?month=${m}`));
      setMonth(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load transactions');
    } finally {
      setLoading(false);
    }
  }, []);

  // Loaded the first time the page is opened, not with the rest of the app.
  useEffect(() => { if (active && !data && !loading && !error) void load(month); }, [active, data, loading, error, load, month]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = data?.transactions ?? [];
    return q ? list.filter((t) => `${t.name} ${t.description} ${t.account} ${t.category ?? ''}`.toLowerCase().includes(q)) : list;
  }, [data, query]);
  const days = useMemo(() => {
    const groups: { date: string; items: typeof shown }[] = [];
    for (const t of shown) {
      const last = groups.at(-1);
      if (last && last.date === t.date) last.items.push(t);
      else groups.push({ date: t.date, items: [t] });
    }
    return groups;
  }, [shown]);

  const current = thisMonth();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 pb-6">
      <PageHeader title="Transactions" subtitle={monthName(month)}>
        <RefreshButton onRefresh={async () => { await onSync(); await load(month); }} />
        {month !== current && <Button variant="outline" size="sm" disabled={loading} onClick={() => load(current)}>This month</Button>}
        <Button variant="ghost" size="icon" aria-label="Previous month" disabled={loading} onClick={() => load(shiftMonth(month, -1))}><ChevronLeft /></Button>
        <Button variant="ghost" size="icon" aria-label="Next month" disabled={loading || month >= current} onClick={() => load(shiftMonth(month, 1))}><ChevronRight /></Button>
      </PageHeader>

      <label className="relative block">
        <span className="sr-only">Search transactions</span>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search this month"
          className="h-10 w-full rounded-lg border border-input bg-background pr-3 pl-9 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
      </label>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
          <Button size="sm" variant="outline" onClick={() => load(month)}>Try again</Button>
        </div>
      )}

      <div className={`flex flex-col gap-4 transition-opacity ${loading ? 'pointer-events-none opacity-50' : ''}`} aria-busy={loading}>
        {data && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border bg-card p-4">
              <p className="text-xs text-muted-foreground">Money out</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{money(data.totals.out)}</p>
            </div>
            <div className="rounded-2xl border bg-card p-4">
              <p className="text-xs text-muted-foreground">Money in</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-primary">{money(data.totals.in)}</p>
            </div>
          </div>
        )}

        <Section title={query ? `${shown.length} matching` : `${data?.transactions.length ?? 0} transactions`}>
          {!data && !error ? <Empty>Loading…</Empty> : days.length === 0 ? (
            <Empty>{query ? 'Nothing matches that search this month.' : 'No transactions this month.'}</Empty>
          ) : (
            <div className="grid min-w-0 gap-4">
              {days.map((g) => (
                <div key={g.date} className="min-w-0">
                  <h3 className="mb-1 text-xs font-medium text-muted-foreground">{dayHeading(g.date)}</h3>
                  <ul className="divide-y">
                    {g.items.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 font-medium">
                            <span className="min-w-0 truncate">{t.name}</span>
                            {t.pending && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal text-muted-foreground">pending</span>}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {t.account}{category(t.category) && ` · ${category(t.category)}`}{t.transfer && ' · between your accounts'}
                          </p>
                        </div>
                        <span className={`shrink-0 tabular-nums ${t.amount < 0 ? 'text-primary' : ''}`}>
                          {t.amount < 0 ? `+${money(-t.amount)}` : money(t.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
