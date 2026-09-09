import { NavLink } from 'react-router';
import { BarChart3, Contact, KanbanSquare, LayoutDashboard, Mail, Phone, Radar, Rocket, Settings, Shield } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useOrg } from '../../hooks/useOrg';
import logoIcon from '../../assets/logo/logo-icon.png';

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
  { to: '/outreach/linkedin', label: 'LinkedIn', icon: Contact },
  { to: '/outreach/autopilot', label: 'Autopilot', icon: Rocket },
  { to: '/dialer', label: 'Power Dialer', icon: Phone },
  { to: '/emails', label: 'Emails', icon: Mail },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function navClass({ isActive }: { isActive: boolean }): string {
  return `flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] font-semibold transition-colors motion-reduce:transition-none ${
    isActive ? 'bg-violet/20 text-nav-text' : 'text-nav-muted hover:bg-nav-hover hover:text-nav-text'
  }`;
}

/** Desktop sidebar navigation. Hidden below md; MobileNav takes over there. */
export function Sidebar() {
  const { currentOrg } = useOrg();
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-nav-line bg-nav-bg p-4 md:flex">
      <img src={logoIcon} alt="" className="mb-2 h-9 px-2" />
      <p className="mb-8 px-2 font-heading text-lg font-extrabold text-nav-text">
        Dreamlabs<span className="text-cyan">Sales</span>
      </p>
      <nav className="flex flex-col gap-1" aria-label="Main">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={navClass}>
            <Icon className="h-5 w-5" aria-hidden />
            {label}
          </NavLink>
        ))}
        {currentOrg?.role === 'admin' && (
          <NavLink to="/admin" className={navClass}>
            <Shield className="h-5 w-5" aria-hidden />
            Admin
          </NavLink>
        )}
      </nav>
    </aside>
  );
}
