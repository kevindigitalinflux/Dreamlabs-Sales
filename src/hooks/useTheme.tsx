import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

export type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Light/dark theme. Seeded from localStorage on first render (fast, avoids a flash
 * of the wrong theme before the account's profile loads), then reconciled once with
 * the account's saved `theme_preference` when it becomes available. Every toggle
 * writes to both localStorage and the profiles table.
 *
 * Scoped to AppShell only (see AppShell.tsx) — never wraps unauthenticated routes,
 * so Login/Welcome always render light with no theme JS running at all.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'));

  useEffect(() => {
    const pref = profile?.theme_preference;
    if (!pref) return;
    setTheme((current) => {
      if (pref === current) return current;
      localStorage.setItem('theme', pref);
      return pref;
    });
  }, [profile?.theme_preference]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'light' ? 'dark' : 'light';
      localStorage.setItem('theme', next);
      if (profile) void supabase.from('profiles').update({ theme_preference: next }).eq('id', profile.id);
      return next;
    });
  }, [profile]);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

/** Access theme state; must be used inside ThemeProvider. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
