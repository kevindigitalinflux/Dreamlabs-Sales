import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Profile, Role } from '../../types';
import { formatShortDate } from '../../lib/utils';
import { useAuth } from '../../hooks/useAuth';

interface UserTableProps {
  users: Profile[];
  onChanged: () => void;
}

/** Admin user list with per-row role editing (via the admin-users Edge Function). */
export function UserTable({ users, onChanged }: UserTableProps) {
  const { profile: me } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function setRole(userId: string, role: Role) {
    setBusyId(userId);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke('admin-users', {
      body: { action: 'set_role', user_id: userId, role },
    });
    setBusyId(null);
    const apiError = err?.message ?? (data as { error?: string } | null)?.error;
    if (apiError) setError(apiError);
    else onChanged();
  }

  return (
    <div className="overflow-x-auto">
      {error && <p role="alert" className="mb-2 text-sm text-red-400">{error}</p>}
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs font-semibold text-muted">
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">Role</th>
            <th className="px-3 py-2">Joined</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-line">
              <td className="px-3 py-3 font-semibold">{u.full_name ?? '—'}</td>
              <td className="px-3 py-3 text-muted">{u.email}</td>
              <td className="px-3 py-3">
                <select
                  aria-label={`Role for ${u.email}`}
                  className="min-h-11 rounded-lg border border-line bg-surface px-2"
                  value={u.role}
                  disabled={u.id === me?.id || busyId === u.id}
                  onChange={(e) => void setRole(u.id, e.target.value as Role)}
                >
                  <option value="contractor">Contractor</option>
                  <option value="admin">Admin</option>
                </select>
              </td>
              <td className="px-3 py-3 text-muted">{formatShortDate(u.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
