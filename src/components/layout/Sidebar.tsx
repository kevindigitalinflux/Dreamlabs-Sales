import { NavLink } from 'react-router';
import { BarChart3, KanbanSquare, LayoutDashboard, Mail, Radar, Settings, Shield } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/pipeline', label: 'Pipeline', icon: KanbanSquare },
  { to: '/scraper', label: 'Scraper', icon: Radar },
  { to: '/emails', label: 'Emails', icon: Mail },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function navClass({ isActive }: { isActive: boolean }): string {
  return `flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] font-semibold transition-colors motion-reduce:transition-none ${
    isActive ? 'bg-violet/20 text-offwhite' : 'text-muted hover:bg-surface hover:text-offwhite'
  }`;
}

/** Desktop sidebar navigation. Hidden below md; MobileNav takes over there. */
export function Sidebar() {
  const { profile } = useAuth();
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-navy/40 p-4 md:flex">
      <p className="mb-8 px-2 font-heading text-lg font-extrabold">
        Dreamlabs<span className="text-cyan">Sales</span>
      </p>
      <nav className="flex flex-col gap-1" aria-label="Main">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={navClass}>
            <Icon className="h-5 w-5" aria-hidden />
            {label}
          </NavLink>
        ))}
        {profile?.role === 'admin' && (
          <NavLink to="/admin" className={navClass}>
            <Shield className="h-5 w-5" aria-hidden />
            Admin
          </NavLink>
        )}
      </nav>
    </aside>
  );
}
