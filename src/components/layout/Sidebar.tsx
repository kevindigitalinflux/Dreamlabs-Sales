import {ApiKeyHealthBadge} from '../settings/ApiKeyHealthBadge';
import { NavLink } from 'react-router';
import { BarChart3, Contact, KanbanSquare, LayoutDashboard, ListChecks, Mail, PanelLeftClose, PanelLeftOpen, Phone, Radar, Rocket, Settings, Shield, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useOrg } from '../../hooks/useOrg';
import { useJobs } from '../../hooks/useJobs';
import { useNeedsInputCount } from '../../hooks/useNeedsInputCount';
import { useNavCollapsed } from '../../hooks/useNavCollapsed';
import logoIcon from '../../assets/logo/logo-icon.png';
import { useReplyAlerts } from '../../hooks/useReplyAlerts';
import { ReplyCountBadge } from '../emails/ReplyAlertParts';

interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean }

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/dream-agent', label: 'Dream Agent', icon: Sparkles },
  { to: '/pipeline', label: 'Pipeline', icon: KanbanSquare },
  { to: '/jobs', label: 'Jobs', icon: ListChecks },
  { to: '/scraper', label: 'Scraper', icon: Radar },
  { to: '/outreach/linkedin', label: 'LinkedIn', icon: Contact },
  { to: '/outreach/autopilot', label: 'Autopilot', icon: Rocket },
  { to: '/dialer', label: 'Power Dialer', icon: Phone },
  { to: '/emails', label: 'Emails', icon: Mail },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const ROW = 'relative flex min-h-11 md:min-h-9 items-center gap-3 rounded-control px-3 text-[15px] md:text-sm font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nav-active';

/** One menu row. Collapsed: the label is kept for screen readers and as a hover title, and the badge sits on the icon's corner. */
function SidebarLink({ item, collapsed, badge }: { item: NavItem; collapsed: boolean; badge?: ReactNode }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) => `${ROW} ${collapsed ? 'justify-center' : ''} ${isActive ? 'bg-violet/20 text-nav-text' : 'text-nav-muted hover:bg-nav-hover hover:text-nav-text'}`}
    >
      <Icon className="h-5 w-5 shrink-0" aria-hidden />
      <span className={collapsed ? 'sr-only' : 'truncate'}>{item.label}</span>
      {badge && <span className={collapsed ? 'absolute right-0.5 top-0.5' : 'ml-auto'}>{badge}</span>}
    </NavLink>
  );
}

/** Desktop menu: fixed to the left edge, collapsible to icons (open by default, remembered per device). Hidden below md; MobileNav takes over there. */
export function Sidebar() {
  const { currentOrg } = useOrg();
  const { count: needsInput } = useNeedsInputCount();
  const { counts } = useJobs();
  const { count: replies } = useReplyAlerts();
  const { collapsed, toggle } = useNavCollapsed();
  const badges: Record<string, ReactNode> = {
    '/settings': <ApiKeyHealthBadge />,
    '/emails': replies > 0 ? <ReplyCountBadge count={replies} /> : null,
    '/outreach/autopilot': needsInput ? (
      <span className="rounded-full bg-violet/25 px-2 py-0.5 text-[11px] font-bold text-nav-active" aria-label={`${needsInput} autopilot leads need your input`}>{needsInput}</span>
    ) : null,
    '/jobs': counts.needsYou > 0 ? (
      <span className="rounded-full bg-violet px-2 py-0.5 text-[11px] font-bold text-on-accent" aria-label={`${counts.needsYou} jobs need you`}>{counts.needsYou}</span>
    ) : null,
  };
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <aside className={`sticky top-0 hidden h-dvh shrink-0 flex-col overflow-hidden border-r border-nav-line bg-nav-bg transition-[width] duration-200 motion-reduce:transition-none md:flex ${collapsed ? 'w-[60px] p-2' : 'w-56 p-3'}`}>
      <div className={`mb-4 flex flex-col gap-1 ${collapsed ? 'items-center pt-2' : 'items-start px-2'}`}>
        <img src={logoIcon} alt="" className="h-9 w-auto" />
        {!collapsed && (
          <p className="whitespace-nowrap font-heading text-lg font-extrabold text-nav-text">Dreamlabs<span className="text-cyan">Sales</span></p>
        )}
      </div>
      <nav className="flex min-h-0 flex-col gap-0.5" aria-label="Main">
        {NAV_ITEMS.map((item) => <SidebarLink key={item.to} item={item} collapsed={collapsed} badge={badges[item.to]} />)}
        {currentOrg?.role === 'admin' && <SidebarLink item={{ to: '/admin', label: 'Admin', icon: Shield }} collapsed={collapsed} />}
      </nav>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        title={collapsed ? 'Expand menu' : undefined}
        className={`${ROW} mt-auto cursor-pointer text-nav-muted hover:bg-nav-hover hover:text-nav-text ${collapsed ? 'justify-center' : ''}`}
      >
        <CollapseIcon className="h-5 w-5 shrink-0" aria-hidden />
        <span className={collapsed ? 'sr-only' : ''}>{collapsed ? 'Expand menu' : 'Collapse menu'}</span>
      </button>
    </aside>
  );
}
