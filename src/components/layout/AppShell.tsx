import { Outlet } from 'react-router';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { MobileNav } from './MobileNav';

/** Main authenticated layout: sidebar (desktop) + topbar + content + mobile tab bar. */
export function AppShell() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 p-4 pb-20 md:p-6 md:pb-6">
          <Outlet />
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
