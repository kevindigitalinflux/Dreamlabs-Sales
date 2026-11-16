import { Focus } from 'lucide-react';
import { useFocusMode } from '../../hooks/useFocusMode';
import { NeedsYouPill } from '../jobs/NeedsYouPill';
import { OrgSwitcher } from './OrgSwitcher';
import { UsageMeter } from './UsageMeter';
import { UserMenu } from './UserMenu';

/** Top bar: focus-mode toggle, the background-jobs pill, usage, organisation switcher and the account menu. */
export function TopBar() {
  const { focusMode, toggle } = useFocusMode();
  return (
    // flex-wrap: on a phone the chips do not fit in one row, so the bar wraps onto a second row instead of clipping.
    <header className="flex min-h-14 flex-wrap items-center justify-end gap-x-3 gap-y-2 border-b border-line px-4 py-2 md:px-7">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={focusMode}
        className={`mr-auto flex min-h-11 cursor-pointer items-center gap-2 rounded-control px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus md:min-h-10 ${focusMode ? 'bg-violet/20 text-link' : 'text-muted hover:bg-surface hover:text-offwhite'}`}
      >
        <Focus className="h-4 w-4" aria-hidden />
        {focusMode ? 'Exit focus' : 'Focus'}
      </button>
      {!focusMode && <NeedsYouPill />}
      <UsageMeter />
      <OrgSwitcher />
      <UserMenu />
    </header>
  );
}
