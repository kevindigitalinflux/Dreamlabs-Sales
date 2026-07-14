import { Focus, LogOut } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useFocusMode } from '../../hooks/useFocusMode';
import { initials } from '../../lib/utils';

/** Top bar: focus-mode toggle + user identity + sign out. */
export function TopBar() {
  const { profile, signOut } = useAuth();
  const { focusMode, toggle } = useFocusMode();
  return (
    <header className="flex min-h-14 items-center justify-end gap-3 border-b border-line px-4">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={focusMode}
        className={`mr-auto flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-semibold ${focusMode ? 'bg-cyan/20 text-cyan' : 'text-muted hover:bg-surface hover:text-offwhite'}`}
      >
        <Focus className="h-4 w-4" aria-hidden />
        {focusMode ? 'Exit focus' : 'Focus'}
      </button>
      <span
        aria-hidden
        className="flex h-8 w-8 items-center justify-center rounded-full bg-purple text-xs font-bold"
      >
        {initials(profile?.full_name)}
      </span>
      <span className="hidden text-sm font-semibold sm:block">{profile?.full_name ?? profile?.email}</span>
      <button
        type="button"
        onClick={() => void signOut()}
        className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-semibold text-muted hover:bg-surface hover:text-offwhite"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        Sign out
      </button>
    </header>
  );
}
