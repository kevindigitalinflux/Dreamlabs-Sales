import { BrowserRouter, Route, Routes } from 'react-router';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { Login } from './pages/Login';

function Home() {
  const { profile, signOut } = useAuth();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <h1 className="text-[22px] font-bold">Signed in as {profile?.full_name ?? profile?.email}</h1>
      <p className="text-muted">Role: {profile?.role}</p>
      <button type="button" onClick={() => void signOut()} className="min-h-11 cursor-pointer rounded-lg bg-surface px-4 font-semibold">
        Sign out
      </button>
    </div>
  );
}

/** App root: router + auth provider. Full route tree arrives in Task 6. */
export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Home />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
