import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { OrgMemberRow, Role } from '../../types';
import { formatShortDate } from '../../lib/utils';
import { useAuth } from '../../hooks/useAuth';

interface UserTableProps {
  members: OrgMemberRow[];
  orgId: string;
  onChanged: () => void;
}

/** Org member list with per-row role editing (via admin-users' set_org_role action). */
export function UserTable({ members, orgId, onChanged }: UserTableProps) {
  const { session } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function setRole(userId: string, role: Role) {
    setBusyId(userId);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke('admin-users', {
      body: { action: 'set_org_role', org_id: orgId, user_id: userId, role },
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
          {members.map((m) => (
            <tr key={m.profiles.id} className="border-b border-line">
              <td className="px-3 py-3 font-semibold">{m.profiles.full_name ?? '—'}</td>
              <td className="px-3 py-3 text-muted">{m.profiles.email}</td>
              <td className="px-3 py-3">
                <select
                  aria-label={`Role for ${m.profiles.email}`}
                  className="min-h-11 rounded-lg border border-line bg-surface px-2"
                  value={m.role}
                  disabled={m.profiles.id === session?.user.id || busyId === m.profiles.id}
                  onChange={(e) => void setRole(m.profiles.id, e.target.value as Role)}
                >
                  <option value="contractor">Contractor</option>
                  <option value="admin">Admin</option>
                </select>
              </td>
              <td className="px-3 py-3 text-muted">{formatShortDate(m.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
