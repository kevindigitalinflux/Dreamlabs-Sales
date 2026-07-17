import { useState } from 'react';
import { FileText, Plus, Star } from 'lucide-react';
import { useTemplates } from '../../hooks/useTemplates';
import { useAuth } from '../../hooks/useAuth';
import type { EmailTemplate } from '../../types';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { TemplateEditor } from './TemplateEditor';

/** Template library: defaults first, then own; click to edit (own or admin), New to create. */
export function TemplateList() {
  const { templates, loading, error, save, remove } = useTemplates();
  const { profile, session } = useAuth();
  const [editing, setEditing] = useState<EmailTemplate | null | 'new'>(null);

  const canEdit = (t: EmailTemplate) => profile?.role === 'admin' || t.created_by === session?.user.id;

  if (loading) return <Skeleton className="h-40 w-full" />;
  if (error) return <p role="alert" className="text-sm text-red-400">{error}</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="self-end">
        <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" aria-hidden />New template</Button>
      </div>
      {templates.length === 0 && <EmptyState icon={FileText} title="No templates yet" hint="Create your first template to draft emails faster." />}
      <ul className="grid gap-3 md:grid-cols-2">
        {templates.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => canEdit(t) ? setEditing(t) : undefined}
              className={`w-full rounded-xl border border-line bg-card p-4 text-left ${canEdit(t) ? 'cursor-pointer hover:bg-surface/50' : 'cursor-default'}`}>
              <div className="flex items-center gap-2">
                <span className="font-heading text-sm font-bold">{t.name}</span>
                {t.is_default && <Star className="h-3.5 w-3.5 text-amber-400" aria-label="Default template" />}
              </div>
              <p className="mt-1 truncate text-sm text-muted">{t.subject}</p>
              <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-xs text-muted">{t.body}</p>
            </button>
          </li>
        ))}
      </ul>
      {editing && (
        <TemplateEditor
          template={editing === 'new' ? null : editing}
          isAdmin={profile?.role === 'admin'}
          onSave={(input, id) => save(input, id)}
          onDelete={(id) => remove(id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
