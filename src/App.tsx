import { BrowserRouter, Route, Routes } from 'react-router';
import { AuthProvider } from './hooks/useAuth';
import { FocusModeProvider } from './hooks/useFocusMode';
import { AdminRoute, ProtectedRoute } from './components/layout/ProtectedRoute';
import { AppShell } from './components/layout/AppShell';
import { ComingSoon } from './components/layout/ComingSoon';
import { Login } from './pages/Login';
import { Welcome } from './pages/Welcome';
import { Dashboard } from './pages/Dashboard';
import { PipelineRedirect } from './pages/PipelineRedirect';
import { PipelineKanban } from './pages/PipelineKanban';
import { PipelineList } from './pages/PipelineList';
import { LeadDetailPage } from './pages/LeadDetailPage';
import { Settings } from './pages/Settings';
import { Admin } from './pages/Admin';

/** App root: full SPEC.md §13 route tree (later-cycle modules render ComingSoon). */
export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <FocusModeProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/pipeline" element={<PipelineRedirect />} />
              <Route path="/pipeline/kanban" element={<PipelineKanban />} />
              <Route path="/pipeline/list" element={<PipelineList />} />
              <Route path="/pipeline/leads/:id" element={<LeadDetailPage />} />
              <Route path="/scraper/*" element={<ComingSoon module="Lead Scraper" />} />
              <Route path="/emails/*" element={<ComingSoon module="Email Automation" />} />
              <Route path="/analytics" element={<ComingSoon module="Analytics" />} />
              <Route path="/settings" element={<Settings />} />
              <Route element={<AdminRoute />}>
                <Route path="/admin" element={<Admin />} />
              </Route>
              <Route path="*" element={<ComingSoon module="This page" />} />
            </Route>
          </Route>
        </Routes>
        </FocusModeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
