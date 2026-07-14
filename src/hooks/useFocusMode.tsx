import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';

interface FocusModeValue {
  focusMode: boolean;
  toggle: () => void;
}

const FocusModeContext = createContext<FocusModeValue | null>(null);

/** Focus mode strips the UI down to the day's essential tasks (ADHD rule 4). */
export function FocusModeProvider({ children }: { children: ReactNode }) {
  const [focusMode, setFocusMode] = useState(() => localStorage.getItem('focus-mode') === 'on');

  const toggle = useCallback(() => {
    setFocusMode((prev) => {
      localStorage.setItem('focus-mode', prev ? 'off' : 'on');
      return !prev;
    });
  }, []);

  return <FocusModeContext.Provider value={{ focusMode, toggle }}>{children}</FocusModeContext.Provider>;
}

/** Access focus mode state; must be used inside FocusModeProvider. */
export function useFocusMode(): FocusModeValue {
  const ctx = useContext(FocusModeContext);
  if (!ctx) throw new Error('useFocusMode must be used inside FocusModeProvider');
  return ctx;
}
