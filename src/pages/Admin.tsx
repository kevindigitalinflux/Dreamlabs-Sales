import { useCallback, useEffect, useState } from 'react';
import { Building2, UserPlus, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useOrg } from '../hooks/useOrg';
import type { OrgMemberRow } from '../types';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { SelectField } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { UserTable } from '../components/admin/UserTable';
import { InviteModal } from '../components/admin/InviteModal';
import { NewOrgModal } from '../components/admin/NewOrgModal';
import { AssignmentPanel } from '../components/admin/AssignmentPanel';

interface OrgOption { id: string; name: string }

/** Admin panel: org-scoped user management + lead assignment (SPEC.md §10). */
export function Admin() {
  const { profile } = useAuth();
  const { currentOrg } = useOrg();
  const isPlatformAdmin = profile?.platform_role === 'platform_admin';

  const [orgOptions, setOrgOptions] = useState<OrgOption[]>([]);
  const [manageOrgId, setManageOrgId] = useState<string>('');
  const [members, setMembers] = useState<OrgMemberRow[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [newOrgOpen, setNewOrgOpen] = useState(false);

  const [currentOrgContractors, setCurrentOrgContractors] = useState<{ id: string; full_name: string | null; email: string }[]>([]);

  const loadOrgs = useCallback(async () => {
    const { data, error: err } = await supabase.functions.invoke('admin-users', { body: { action: 'list_orgs' } });
    setLoadingOrgs(false);
    if (err) return setError(err.message);
    const orgs = (data as { orgs: OrgOption[] }).orgs;
    setOrgOptions(orgs);
    setManageOrgId((prev) => prev || currentOrg?.id || orgs[0]?.id || '');
  }, [currentOrg]);

  const loadMembers = useCallback(async (orgId: string) => {
    if (!orgId) return;
    setLoadingMembers(true);
    const { data, error: err } = await supabase.functions.invoke('admin-users', { body: { action: 'list_org_members', org_id: orgId } });
    setLoadingMembers(false);
    if (err) return setError(err.message);
    setMembers((data as { members: OrgMemberRow[] }).members);
  }, []);

  useEffect(() => { void loadOrgs(); }, [loadOrgs]);
  useEffect(() => { if (manageOrgId) void loadMembers(manageOrgId); }, [manageOrgId, loadMembers]);

  useEffect(() => {
    if (!currentOrg) return;
    void supabase.functions.invoke('admin-users', { body: { action: 'list_org_members', org_id: currentOrg.id } })
      .then(({ data }) => {
        const rows = (data as { members: OrgMemberRow[] } | null)?.members ?? [];
        setCurrentOrgContractors(rows.filter((r) => r.role === 'contractor').map((r) => r.profiles));
      });
  }, [currentOrg]);

  if (loadingOrgs) return <Skeleton className="h-40 w-full max-w-4xl" />;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-extrabold">Admin</h1>
        <div className="flex items-center gap-2">
          {isPlatformAdmin && (
            <Button variant="secondary" onClick={() => setNewOrgOpen(true)}>
              <Building2 className="h-4 w-4" aria-hidden />
              New organization
            </Button>
          )}
          <Button onClick={() => setInviteOpen(true)} disabled={!manageOrgId}>
            <UserPlus className="h-4 w-4" aria-hidden />
            Invite
          </Button>
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[18px] font-bold">Members</h2>
          {isPlatformAdmin && orgOptions.length > 1 && (
            <div className="w-64">
              <SelectField label="Manage members of" value={manageOrgId} onChange={(e) => setManageOrgId(e.target.value)}>
                {orgOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </SelectField>
            </div>
          )}
        </div>
        {loadingMembers && <Skeleton className="h-40 w-full" />}
        {!loadingMembers && members.length === 0 && (
          <EmptyState icon={Users} title="No members yet" hint="Invite the first person to this organization." />
        )}
        {!loadingMembers && members.length > 0 && (
          <UserTable members={members} orgId={manageOrgId} onChanged={() => void loadMembers(manageOrgId)} />
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-[18px] font-bold">Lead assignment {currentOrg ? `— ${currentOrg.name}` : ''}</h2>
        <AssignmentPanel contractors={currentOrgContractors} />
      </Card>

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} orgId={manageOrgId} onInvited={() => void loadMembers(manageOrgId)} />
      {isPlatformAdmin && (
        <NewOrgModal open={newOrgOpen} onClose={() => setNewOrgOpen(false)} onCreated={(org) => { setManageOrgId(org.id); void loadOrgs(); }} />
      )}
    </div>
  );
}
