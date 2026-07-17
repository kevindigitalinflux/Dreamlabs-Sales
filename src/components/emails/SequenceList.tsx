import { useState } from 'react';
import { ListOrdered, Plus, Star } from 'lucide-react';
import { useSequences } from '../../hooks/useSequences';
import { useAuth } from '../../hooks/useAuth';
import { timelineLabel } from '../../lib/sequenceMath';
import type { EmailSequence } from '../../types';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { SequenceBuilder } from './SequenceBuilder';

/** Sequence library: defaults first, then own; click to edit (own or admin), New to create. */
export function SequenceList() {
  const { sequences, loading, error, save, remove } = useSequences();
  const { profile, session } = useAuth();
  const [editing, setEditing] = useState<EmailSequence | null | 'new'>(null);

  const canEdit = (s: EmailSequence) => profile?.role === 'admin' || s.created_by === session?.user.id;

  if (loading) return <Skeleton className="h-40 w-full" />;
  if (error) return <p role="alert" className="text-sm text-red-400">{error}</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="self-end">
        <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" aria-hidden />New sequence</Button>
      </div>
      {sequences.length === 0 && <EmptyState icon={ListOrdered} title="No sequences yet" hint="Create your first sequence to automate follow-ups." />}
      <ul className="grid gap-3 md:grid-cols-2">
        {sequences.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => canEdit(s) ? setEditing(s) : undefined}
              className={`w-full rounded-xl border border-line bg-card p-4 text-left ${canEdit(s) ? 'cursor-pointer hover:bg-surface/50' : 'cursor-default'}`}>
              <div className="flex items-center gap-2">
                <span className="font-heading text-sm font-bold">{s.name}</span>
                {s.is_default && <Star className="h-3.5 w-3.5 text-amber-400" aria-label="Default sequence" />}
              </div>
              {s.description && <p className="mt-1 truncate text-sm text-muted">{s.description}</p>}
              <p className="mt-2 text-xs text-muted">{s.steps.length} {s.steps.length === 1 ? 'step' : 'steps'}</p>
              <p className="mt-1 text-xs text-cyan">{timelineLabel(s.steps)}</p>
            </button>
          </li>
        ))}
      </ul>
      {editing && (
        <SequenceBuilder
          sequence={editing === 'new' ? null : editing}
          isAdmin={profile?.role === 'admin'}
          onSave={(input, id) => save(input, id)}
          onDelete={(id) => remove(id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
