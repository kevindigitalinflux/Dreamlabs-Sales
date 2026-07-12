import { useState } from 'react';
import { UserPlus, Users } from 'lucide-react';
import { useProfiles } from '../hooks/useProfiles';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { UserTable } from '../components/admin/UserTable';
import { InviteModal } from '../components/admin/InviteModal';
import { AssignmentPanel } from '../components/admin/AssignmentPanel';

/** Admin panel: user management + lead assignment (SPEC.md §10). */
export function Admin() {
  const { profiles, loading, error, refresh } = useProfiles();
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] font-extrabold">Admin</h1>
        <Button onClick={() => setInviteOpen(true)}>
          <UserPlus className="h-4 w-4" aria-hidden />
          Invite contractor
        </Button>
      </div>

      <Card>
        <h2 className="mb-3 text-[18px] font-bold">Users</h2>
        {loading && <Skeleton className="h-40 w-full" />}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        {!loading && !error && profiles.length === 0 && (
          <EmptyState icon={Users} title="No users yet" hint="Invite your first contractor to get started." />
        )}
        {!loading && !error && profiles.length > 0 && <UserTable users={profiles} onChanged={() => void refresh()} />}
      </Card>

      <Card>
        <h2 className="mb-3 text-[18px] font-bold">Lead assignment</h2>
        <AssignmentPanel profiles={profiles.filter((p) => p.role === 'contractor')} />
      </Card>

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} onInvited={() => void refresh()} />
    </div>
  );
}
