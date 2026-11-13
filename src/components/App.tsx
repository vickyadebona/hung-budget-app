import { useCallback, useEffect, useState } from 'react';
import { LayoutDashboard, PiggyBank, RefreshCw, Settings as SettingsIcon } from 'lucide-react';
import Dashboard from './Dashboard';
import Budget from './Budget';
import Settings from './Settings';
import PageSkeleton from './Skeleton';
import { Button } from '@/components/ui/button';
import { api } from './shared';
import type { Summary } from '@/lib/summary';
import type { Budget as BudgetData } from '@/lib/budget';

type Tab = 'overview' | 'budget';
const TABS: { id: Tab; label: string; Icon: typeof PiggyBank }[] = [
  { id: 'overview', label: 'Overview', Icon: LayoutDashboard },
  { id: 'budget', label: 'Budget', Icon: PiggyBank },
];

type Loaded = { summary: Summary; budget: BudgetData };

/** The page opens straight away with a skeleton, then fills in once the bank and budget data arrive. */
export default function App({ month, userName, userEmail }: { month: string; userName: string; userEmail: string }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [summary, budget] = await Promise.all([api<Summary>('/api/summary'), api<BudgetData>(`/api/budget?month=${month}`)]);
      setData({ summary, budget });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your data');
    }
  }, [month]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (location.hash === '#budget') setTab('budget'); }, []);
  const go = (t: Tab) => { setTab(t); history.replaceState(null, '', t === 'budget' ? '#budget' : location.pathname + location.search); window.scrollTo(0, 0); };

  return (
    <>
      {!data && !error && <PageSkeleton />}
      {!data && error && (
        <div className="mx-auto grid w-full max-w-2xl gap-3 p-4 pt-10" role="alert">
          <p className="text-base font-semibold">Couldn't load your accounts</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <div>
            <Button size="lg" variant="outline" loading={retrying}
              onClick={async () => { setRetrying(true); await load(); setRetrying(false); }}>
              <RefreshCw /> Try again
            </Button>
          </div>
        </div>
      )}
      {data && (
        <>
          {/* Both stay mounted so a half-typed edit survives switching tabs. */}
          <div hidden={tab !== 'overview'}>
            <Dashboard initial={data.summary} userName={userName} userEmail={userEmail} notices={data.budget.notices} onOpenBudget={() => go('budget')} />
          </div>
          <div hidden={tab !== 'budget'}><Budget initial={data.budget} /></div>
        </>
      )}
      <div className="pb-24" aria-hidden="true" />
      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} userName={userName} />
      <nav aria-label="Sections" className="fixed inset-x-0 bottom-0 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto grid max-w-2xl grid-cols-3">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} type="button" onClick={() => go(id)} aria-current={tab === id ? 'page' : undefined}
              className={`flex flex-col items-center gap-0.5 py-2.5 text-xs ${tab === id ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>
              <Icon className="size-5" />{label}
            </button>
          ))}
          <button type="button" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog"
            className="flex flex-col items-center gap-0.5 py-2.5 text-xs text-muted-foreground">
            <SettingsIcon className="size-5" />Settings
          </button>
        </div>
      </nav>
    </>
  );
}
