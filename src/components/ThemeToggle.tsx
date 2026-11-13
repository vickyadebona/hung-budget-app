import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

type Pref = 'auto' | 'light' | 'dark';
const KEY = 'bud_theme'; // also read by the inline script in Base.astro, before first paint
const OPTIONS: { id: Pref; label: string; Icon: typeof Sun }[] = [
  { id: 'auto', label: 'System', Icon: Monitor },
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'dark', label: 'Dark', Icon: Moon },
];

function apply(pref: Pref) {
  const dark = pref === 'dark' || (pref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.classList.toggle('dark', dark);
}

/** System / Light / Dark. "System" is the default and follows the device, including when it changes at sunset. */
export default function ThemeToggle() {
  const [pref, setPref] = useState<Pref>('auto');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'light' || saved === 'dark') setPref(saved);
    } catch { /* private mode: stay on System */ }
  }, []);

  useEffect(() => {
    apply(pref);
    if (pref !== 'auto') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('auto');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  const choose = (next: Pref) => {
    setPref(next);
    try {
      if (next === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch { /* private mode: applies until the page is closed */ }
  };

  return (
    <div role="radiogroup" aria-label="Appearance" className="inline-grid grid-cols-3 gap-1 rounded-xl border bg-muted p-1">
      {OPTIONS.map(({ id, label, Icon }) => (
        <button key={id} type="button" role="radio" aria-checked={pref === id} onClick={() => choose(id)}
          className={`flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${pref === id ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground'}`}>
          <Icon className="size-4" />{label}
        </button>
      ))}
    </div>
  );
}
