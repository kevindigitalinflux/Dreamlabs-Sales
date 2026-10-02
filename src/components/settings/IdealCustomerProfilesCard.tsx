import { useState } from 'react';
import { Plus, Users } from 'lucide-react';
import { useIcps } from '../../hooks/useIcps';
import type { IdealCustomerProfile } from '../../types';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Skeleton } from '../ui/Skeleton';
import { IcpEditor } from './IcpEditor';

/**
 * Settings section, directly under Company context, for the org's ideal customer profiles:
 * who it sells to, their pain points, goals, objections and how to talk to them. Templates,
 * sequences and individual leads can each point at one, and emails written for that
 * customer then use its pain points and context. Visible to every member; admins edit.
 */
export function IdealCustomerProfilesCard({ isOrgAdmin }: { isOrgAdmin: boolean }) {
  const { icps, loading, error, save, remove } = useIcps();
  const [editing, setEditing] = useState<IdealCustomerProfile | null | 'new'>(null);

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-bold">Ideal customer profiles</h2>
            <p className="mt-1 text-sm text-muted">
              Describe each kind of customer you sell to, in as much detail as you can: who they are, what keeps them up
              at night, what they want, what they push back on. Pick a profile on a template, a sequence or a lead, and
              the emails written for it use that context, including <code>{'{{pain_point}}'}</code>, so they read as
              written for that customer.
            </p>
          </div>
          {isOrgAdmin && (
            <Button className="shrink-0" onClick={() => setEditing('new')}><Plus className="h-4 w-4" aria-hidden />Add profile</Button>
          )}
        </div>
        {loading && <Skeleton className="h-20 w-full" />}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {!loading && icps.length === 0 && (
          <p className="flex items-center gap-2 rounded-lg bg-surface/60 p-3 text-sm text-muted">
            <Users className="h-4 w-4 shrink-0" aria-hidden />
            {isOrgAdmin ? 'No profiles yet. Add your first one, for example "Property managers".' : 'No profiles yet. An org admin can add them.'}
          </p>
        )}
        <ul className="grid gap-2 sm:grid-cols-2">
          {icps.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setEditing(p)} className="w-full cursor-pointer rounded-lg border border-line bg-surface/40 p-3 text-left hover:bg-surface/70">
                <span className="block text-sm font-bold">{p.name}</span>
                <span className="mt-1 line-clamp-2 block whitespace-pre-wrap text-xs text-muted">{p.summary ?? p.pain_points ?? 'No details yet'}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {editing && (
        <IcpEditor
          profile={editing === 'new' ? null : editing}
          canEdit={isOrgAdmin}
          onSave={save}
          onDelete={remove}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}
