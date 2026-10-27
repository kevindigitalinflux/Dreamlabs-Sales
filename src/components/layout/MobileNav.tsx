import { NavLink } from 'react-router';
import { KanbanSquare, LayoutDashboard, Settings, Mail } from 'lucide-react';
import { useReplyAlerts } from '../../hooks/useReplyAlerts';
import { ReplyCountBadge } from '../emails/ReplyAlertParts';
import type { LucideIcon } from 'lucide-react';

const ITEMS: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/', label: 'Today', icon: LayoutDashboard, end: true },
  { to: '/pipeline/list', label: 'Pipeline', icon: KanbanSquare },
  { to: '/emails', label: 'Emails', icon: Mail },
  { to: '/settings', label: 'Settings', icon: Settings },
];

/** Bottom tab bar for mobile (spec: mobile is note-taking first — Dashboard, List, Settings). */
export function MobileNav() {
  const { count } = useReplyAlerts();
  return (
    <nav
      aria-label="Mobile"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-nav-line bg-nav-bg md:hidden"
    >
      {ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold ${
              isActive ? 'text-cyan' : 'text-nav-muted'
            }`
          }
        >
          <Icon className="h-5 w-5" aria-hidden />
          {label}
          {to === '/emails' && <ReplyCountBadge count={count} />}
        </NavLink>
      ))}
    </nav>
  );
}
