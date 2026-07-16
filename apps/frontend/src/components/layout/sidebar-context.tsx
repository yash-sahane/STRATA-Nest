'use client';

import * as React from 'react';

interface SidebarContextValue {
  collapsed: boolean;
  toggle: () => void;
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null);
const STORAGE_KEY = 'sidebar-collapsed';

/**
 * Holds the sidebar collapse state as React state (persisted to localStorage)
 * instead of mutating a `--sidebar-width` CSS variable imperatively on
 * `document.documentElement`. Both the sidebar and the layout's content offset
 * read from here, so width stays a single declarative source of truth.
 */
export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState(false);

  // Hydrate persisted preference after mount. First render matches the server
  // (false) so there's no hydration mismatch; a stored "collapsed" then applies
  // via the existing width/padding transitions rather than a hard jump.
  React.useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setCollapsed(stored === 'true');
  }, []);

  const toggle = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  const value = React.useMemo(() => ({ collapsed, toggle }), [collapsed, toggle]);
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarContextValue {
  const ctx = React.useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used within a SidebarProvider');
  return ctx;
}
