import { useCallback, useEffect, useState } from 'react';
import { UserCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Lead, Profile } from '../../types';
import { Button } from '../ui/Button';
import { SelectField } from '../ui/Input';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';

/** Bulk-assign unassigned leads to a contractor (SPEC.md §10). */
export function AssignmentPanel({ profiles }: { profiles: Profile[] }) {
  const [unassigned, setUnassigned] = useState<Lead[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignee, setAssignee] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('leads').select('*').is('assigned_to', null).order('created_at');
    if (err) setError(err.message);
    else setUnassigned(data as Lead[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function assign() {
    if (!assignee || selected.size === 0) return;
    const { error: err } = await supabase
      .from('leads').update({ assigned_to: assignee }).in('id', [...selected]);
    if (err) setError(err.message);
    else {
      setSelected(new Set());
      await load();
    }
  }

  if (loading) return <Skeleton className="h-40 w-full" />;
  if (error) return <p role="alert" className="text-sm text-red-400">{error}</p>;
  if (unassigned.length === 0) {
    return <EmptyState icon={UserCheck} title="No unassigned leads" hint="Every lead in the pipeline has an owner." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {unassigned.map((lead) => (
          <li key={lead.id}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-surface">
              <input type="checkbox" checked={selected.has(lead.id)} onChange={() => toggle(lead.id)} className="h-5 w-5 accent-violet-500" />
              <span className="font-semibold">{lead.business_name}</span>
              <span className="text-sm text-muted">{lead.city ?? ''}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex items-end gap-3">
        <SelectField label="Assign selected to" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Choose contractor…</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>
          ))}
        </SelectField>
        <Button onClick={() => void assign()} disabled={!assignee || selected.size === 0}>
          Assign {selected.size > 0 ? `(${selected.size})` : ''}
        </Button>
      </div>
    </div>
  );
}
