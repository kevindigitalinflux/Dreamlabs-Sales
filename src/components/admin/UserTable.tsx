import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { OrgMemberRow, Role } from '../../types';
import { formatShortDate } from '../../lib/utils';
import { useAuth } from '../../hooks/useAuth';
import { Listbox } from '../ui/Listbox';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface UserTableProps {
  members: OrgMemberRow[];
  orgId: string;
  onChanged: () => void;
}

/** Org member list with per-row role editing and removal (via admin-users' set_org_role/remove_member actions). */
export function UserTable({ members, orgId, onChanged }: UserTableProps) {
  const { session } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<OrgMemberRow | null>(null);

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

  async function removeMember(userId: string) {
    setBusyId(userId);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke('admin-users', {
      body: { action: 'remove_member', org_id: orgId, user_id: userId },
    });
    setBusyId(null);
    setPendingRemoval(null);
    const apiError = err?.message ?? (data as { error?: string } | null)?.error;
    if (apiError) setError(apiError);
    else onChanged();
  }

  return (
    <div className="overflow-x-auto">
      {error && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs font-semibold text-muted">
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">Role</th>
            <th className="px-3 py-2">Joined</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const isSelf = m.profiles.id === session?.user.id;
            return (
              <tr key={m.profiles.id} className="border-b border-line">
                <td className="px-3 py-3 font-semibold">{m.profiles.full_name ?? '—'}</td>
                <td className="px-3 py-3 text-muted">{m.profiles.email}</td>
                <td className="px-3 py-3">
                  <Listbox
                    ariaLabel={`Role for ${m.profiles.email}`}
                    value={m.role}
                    disabled={isSelf || busyId === m.profiles.id}
                    onChange={(e) => void setRole(m.profiles.id, e.target.value as Role)}
                    fullWidth={false}
                  >
                    <option value="contractor">Contractor</option>
                    <option value="team_member">Team Member</option>
                    <option value="admin">Admin</option>
                  </Listbox>
                </td>
                <td className="px-3 py-3 text-muted">{formatShortDate(m.created_at)}</td>
                <td className="px-3 py-3">
                  <button
                    type="button"
                    disabled={isSelf || busyId === m.profiles.id}
                    onClick={() => setPendingRemoval(m)}
                    className="text-sm font-semibold text-danger hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:no-underline"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Modal
        open={pendingRemoval !== null}
        onClose={() => setPendingRemoval(null)}
        title="Remove member"
      >
        <p className="mb-4 text-sm text-muted">
          Remove {pendingRemoval?.profiles.full_name ?? pendingRemoval?.profiles.email} from this
          organization? Any leads currently assigned to them will become unassigned.
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setPendingRemoval(null)}>Cancel</Button>
          <Button
            variant="danger"
            disabled={busyId === pendingRemoval?.profiles.id}
            onClick={() => pendingRemoval && void removeMember(pendingRemoval.profiles.id)}
          >
            Remove
          </Button>
        </div>
      </Modal>
    </div>
  );
}
