import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';

/** Light/dark segmented toggle — both options always visible, matching the Analytics period-toggle pattern (docs/superpowers/specs/2026-09-09-light-dark-theme-design.md). */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <div role="group" aria-label="Theme" className="flex items-center gap-1 rounded-lg border border-line p-1">
      <button
        type="button"
        onClick={() => theme !== 'light' && toggle()}
        aria-pressed={theme === 'light'}
        aria-label="Light mode"
        className={`flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md ${theme === 'light' ? 'bg-violet text-on-accent' : 'text-muted hover:text-offwhite'}`}
      >
        <Sun className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => theme !== 'dark' && toggle()}
        aria-pressed={theme === 'dark'}
        aria-label="Dark mode"
        className={`flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md ${theme === 'dark' ? 'bg-violet text-on-accent' : 'text-muted hover:text-offwhite'}`}
      >
        <Moon className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
