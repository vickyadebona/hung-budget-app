import { useEffect, useState } from 'react';
import { LayoutDashboard, PiggyBank, Settings as SettingsIcon } from 'lucide-react';
import Dashboard from './Dashboard';
import Budget from './Budget';
import Settings from './Settings';
import type { Summary } from '@/lib/summary';
import type { Budget as BudgetData } from '@/lib/budget';

type Tab = 'overview' | 'budget';
const TABS: { id: Tab; label: string; Icon: typeof PiggyBank }[] = [
  { id: 'overview', label: 'Overview', Icon: LayoutDashboard },
  { id: 'budget', label: 'Budget', Icon: PiggyBank },
];

export default function App({ summary, budget, userName, userEmail }: { summary: Summary; budget: BudgetData; userName: string; userEmail: string }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => { if (location.hash === '#budget') setTab('budget'); }, []);
  const go = (t: Tab) => { setTab(t); history.replaceState(null, '', t === 'budget' ? '#budget' : location.pathname + location.search); window.scrollTo(0, 0); };

  return (
    <>
      {/* Both stay mounted so a half-typed edit survives switching tabs. */}
      <div hidden={tab !== 'overview'}><Dashboard initial={summary} userName={userName} userEmail={userEmail} notices={budget.notices} onOpenBudget={() => go('budget')} /></div>
      <div hidden={tab !== 'budget'}><Budget initial={budget} /></div>
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
