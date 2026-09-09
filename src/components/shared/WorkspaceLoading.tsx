import { CalendarDays, Inbox, LayoutDashboard, Newspaper, WalletCards } from 'lucide-react';
import { createContext, useCallback, useContext, useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';
// Eager styles must arrive before any lazy workspace code.
import './WorkspaceLoading.css';

type Surface = 'dashboard' | 'inbox' | 'calendar' | 'news' | 'finances';
const surfaces = {
  dashboard: { icon: LayoutDashboard, title: 'Loading your dashboard', caption: 'Getting your day ready.' },
  inbox: { icon: Inbox, title: 'Loading your inbox', caption: 'Getting your mail ready.' },
  calendar: { icon: CalendarDays, title: 'Loading your calendar', caption: 'Getting your schedule ready.' },
  news: { icon: Newspaper, title: 'Loading your news', caption: 'Getting your headlines ready.' },
  finances: { icon: WalletCards, title: 'Loading your finances', caption: 'Getting your bills and activity ready.' },
};
const LoadingContext = createContext<((surface: Surface) => () => void) | null>(null);

/** Stage handoffs update one owner before paint, preserving the SVG and its animation. */
export function WorkspaceLoadingProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState(new Map<symbol, Surface>());
  const acquire = useCallback((surface: Surface) => {
    const key = Symbol();
    setPending(current => new Map(current).set(key, surface));
    return () => setPending(current => { const next = new Map(current); next.delete(key); return next; });
  }, []);
  const active = [...pending.values()];
  const surface = active[active.length - 1] ?? 'dashboard';
  const { icon: Icon, title, caption } = surfaces[surface];
  return <LoadingContext value={acquire}>
    {children}
    <div className="workspace-loading" role="status" data-surface={surface} hidden={pending.size === 0}>
      <div className="workspace-loading-hero" aria-hidden="true"><Icon size={72} strokeWidth={1.2}/></div>
      <p className="workspace-loading-title">{title}</p>
      <p className="workspace-loading-caption">{caption}</p>
    </div>
  </LoadingContext>;
}

export default function WorkspaceLoading({ surface }: { surface: Surface }) {
  const acquire = useContext(LoadingContext);
  useLayoutEffect(() => acquire?.(surface), [acquire, surface]);
  return null;
}
