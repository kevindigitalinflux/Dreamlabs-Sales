import { Outlet } from 'react-router';
import { Sidebar } from './Sidebar';
import { BackLink } from './BackLink';
import { TopBar } from './TopBar';
import { MobileNav } from './MobileNav';
import { useFocusMode } from '../../hooks/useFocusMode';
import { ThemeProvider } from '../../hooks/useTheme';
import { JobsProvider } from '../../hooks/useJobs';
import { JobsAnnouncer } from '../jobs/JobsAnnouncer';
import { ReplyAlertsProvider } from '../../hooks/useReplyAlerts';
import { ReplyBanner } from '../emails/ReplyAlertParts';

/** Main authenticated layout; focus mode hides all navigation chrome. */
export function AppShell() {
  const { focusMode } = useFocusMode();
  return (
    <ThemeProvider>
      <JobsProvider>
        <ReplyAlertsProvider>
        <div className="relative flex min-h-screen">
          {!focusMode && <Sidebar />}
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            {!focusMode && <ReplyBanner />}
            {!focusMode && <JobsAnnouncer />}
            <main className="flex-1 p-4 pb-20 md:px-7 md:py-6 md:pb-6">
              <BackLink />
              <Outlet />
            </main>
          </div>
          {!focusMode && <MobileNav />}
        </div>
        </ReplyAlertsProvider>
      </JobsProvider>
    </ThemeProvider>
  );
}
