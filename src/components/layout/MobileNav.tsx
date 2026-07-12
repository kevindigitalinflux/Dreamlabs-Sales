import { NavLink } from 'react-router';
import { KanbanSquare, LayoutDashboard, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const ITEMS: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/', label: 'Today', icon: LayoutDashboard, end: true },
  { to: '/pipeline/list', label: 'Pipeline', icon: KanbanSquare },
  { to: '/settings', label: 'Settings', icon: Settings },
];

/** Bottom tab bar for mobile (spec: mobile is note-taking first — Dashboard, List, Settings). */
export function MobileNav() {
  return (
    <nav
      aria-label="Mobile"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-navy/95 backdrop-blur md:hidden"
    >
      {ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold ${
              isActive ? 'text-cyan' : 'text-muted'
            }`
          }
        >
          <Icon className="h-5 w-5" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
