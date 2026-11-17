import { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutDashboard, Menu, PiggyBank, ReceiptText, Repeat, RefreshCw, Settings as SettingsIcon, X } from 'lucide-react';
import Dashboard from './Dashboard';
import Budget from './Budget';
import Transactions from './Transactions';
import Recurring from './Recurring';
import Settings from './Settings';
import PageSkeleton from './Skeleton';
import { Button } from '@/components/ui/button';
import { api } from './shared';
import type { Summary } from '@/lib/summary';
import type { Budget as BudgetData } from '@/lib/budget';

type Page = 'overview' | 'transactions' | 'recurring' | 'budget';
const PAGES: { id: Page; label: string; Icon: typeof PiggyBank }[] = [
  { id: 'overview', label: 'Overview', Icon: LayoutDashboard },
  { id: 'transactions', label: 'Transactions', Icon: ReceiptText },
  { id: 'recurring', label: 'Recurring', Icon: Repeat },
  { id: 'budget', label: 'Budget', Icon: PiggyBank },
];
const fromHash = (): Page => {
  const h = location.hash.slice(1);
  return PAGES.some((p) => p.id === h) ? (h as Page) : 'overview';
};

type Loaded = { summary: Summary; budget: BudgetData };

function Logo() {
  return (
    <span className="flex items-center gap-2 text-base font-semibold tracking-tight">
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm text-primary-foreground" aria-hidden="true">$</span>
      Budget
    </span>
  );
}

/** The list of pages plus Settings, shared by the desktop sidebar and the phone menu. */
function NavList({ page, onGo, onSettings, userName }: { page: Page; onGo: (p: Page) => void; onSettings: () => void; userName: string }) {
  const item = 'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50';
  return (
    <div className="flex h-full flex-col gap-1">
      <ul className="grid gap-1">
        {PAGES.map(({ id, label, Icon }) => (
          <li key={id}>
            <button type="button" onClick={() => onGo(id)} aria-current={page === id ? 'page' : undefined}
              className={`${item} ${page === id ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent/60'}`}>
              <Icon className={`size-4 ${page === id ? 'text-primary' : 'text-muted-foreground'}`} />{label}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-auto grid gap-1 border-t border-sidebar-border pt-3">
        <button type="button" onClick={onSettings} aria-haspopup="dialog" className={`${item} text-sidebar-foreground hover:bg-sidebar-accent/60`}>
          <SettingsIcon className="size-4 text-muted-foreground" />Settings
        </button>
        <p className="truncate px-3 pt-1 text-xs text-muted-foreground">{userName}</p>
      </div>
    </div>
  );
}

/** The page opens straight away with a skeleton, then fills in once the bank and budget data arrive. */
export default function App({ month, userName, userEmail, demo = false }: { month: string; userName: string; userEmail: string; demo?: boolean }) {
  const [page, setPage] = useState<Page>('overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [data, setData] = useState<Loaded | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null); // kept fresh by the Overview's Refresh
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, budget] = await Promise.all([api<Summary>('/api/summary'), api<BudgetData>(`/api/budget?month=${month}`)]);
      setData({ summary: s, budget });
      setSummary(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your data');
    }
  }, [month]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setPage(fromHash());
    const onHash = () => setPage(fromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    menuButton.current?.focus();
  }, []);
  const go = (p: Page) => {
    setPage(p);
    history.replaceState(null, '', p === 'overview' ? location.pathname + location.search : `#${p}`);
    window.scrollTo(0, 0);
    if (menuOpen) closeMenu();
  };
  const openSettings = () => { if (menuOpen) setMenuOpen(false); setSettingsOpen(true); };

  // Phone menu: Escape closes it, and focus moves into it when it opens.
  useEffect(() => {
    if (!menuOpen) return;
    drawer.current?.querySelector<HTMLElement>('button[aria-current="page"], button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [menuOpen, closeMenu]);

  const nav = <NavList page={page} onGo={go} onSettings={openSettings} userName={userName} />;

  return (
    <div className="min-h-svh bg-background">
      {/* Tablet and desktop: a fixed sidebar. */}
      <aside aria-label="Sections" className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col gap-6 border-r border-sidebar-border bg-sidebar p-4 md:flex">
        <Logo />
        <nav className="min-h-0 flex-1" aria-label="Pages">{nav}</nav>
      </aside>

      {/* Phone: a top bar with a menu button, and a menu that slides in from the left. */}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b bg-background/95 px-2 py-2 backdrop-blur md:hidden">
        <Button ref={menuButton} variant="ghost" size="icon" aria-label="Open menu" aria-expanded={menuOpen} aria-controls="mobile-menu" onClick={() => setMenuOpen(true)}>
          <Menu />
        </Button>
        <Logo />
      </header>
      <div className={`fixed inset-0 z-30 bg-black/50 transition-opacity md:hidden ${menuOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={closeMenu} aria-hidden="true" />
      <div id="mobile-menu" ref={drawer} role="dialog" aria-modal="true" aria-label="Menu" inert={!menuOpen}
        className={`fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] flex-col gap-6 bg-sidebar p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl transition-transform duration-200 md:hidden ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between">
          <Logo />
          <Button variant="ghost" size="icon" aria-label="Close menu" onClick={closeMenu}><X /></Button>
        </div>
        <nav className="min-h-0 flex-1" aria-label="Pages">{nav}</nav>
      </div>

      <main className="md:pl-60">
        {demo && (
          <div className="bg-primary px-4 py-1.5 text-center text-xs font-medium text-primary-foreground">
            Demo · every account and amount here is made up
          </div>
        )}
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
            {/* All pages stay mounted so a half-typed edit survives switching pages. */}
            <div hidden={page !== 'overview'}>
              <Dashboard initial={data.summary} userName={userName} userEmail={userEmail} demo={demo} notices={data.budget.notices}
                onOpenBudget={() => go('budget')} onOpenRecurring={() => go('recurring')} onSummary={setSummary} />
            </div>
            <div hidden={page !== 'transactions'}><Transactions active={page === 'transactions'} /></div>
            <div hidden={page !== 'recurring'}><Recurring data={summary ?? data.summary} /></div>
            <div hidden={page !== 'budget'}><Budget initial={data.budget} /></div>
          </>
        )}
      </main>
      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} userName={userName} demo={demo} />
    </div>
  );
}
