import { LogOut } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { initials } from '../../lib/utils';

/** Top bar: user identity + sign out. Focus-mode toggle is added in Task 16. */
export function TopBar() {
  const { profile, signOut } = useAuth();
  return (
    <header className="flex min-h-14 items-center justify-end gap-3 border-b border-line px-4">
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
