import { useCallback, useRef, useState } from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { initials } from '../../lib/utils';
import { Popover } from '../ui/Popover';
import { Button } from '../ui/Button';

/** Avatar button in the top bar. Opens the account menu: who is signed in and Sign out. */
export function UserMenu() {
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const name = profile?.full_name ?? profile?.email;
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full pr-2 text-sm font-semibold hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus md:min-h-10"
      >
        {profile?.avatar_url ? (
          <img src={profile.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
        ) : (
          <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-purple text-xs font-bold text-on-accent">{initials(profile?.full_name)}</span>
        )}
        <span className="hidden max-w-40 truncate sm:block">{name}</span>
      </button>
      <Popover open={open} onClose={close} anchorRef={anchorRef} label="Account" className="w-64">
        <div className="flex flex-col gap-3 p-2">
          <div className="min-w-0">
            <p className="truncate font-semibold">{profile?.full_name ?? 'Signed in'}</p>
            {profile?.email && <p className="truncate text-sm text-muted">{profile.email}</p>}
          </div>
          <Button variant="secondary" onClick={() => void signOut()}>
            <LogOut className="h-4 w-4" aria-hidden />
            Sign out
          </Button>
        </div>
      </Popover>
    </>
  );
}
