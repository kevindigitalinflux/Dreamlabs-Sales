import { useRef, useState } from 'react';
import { FileText, Link2, Paperclip, Plus, Star } from 'lucide-react';
import { useTemplates } from '../../hooks/useTemplates';
import { useAuth } from '../../hooks/useAuth';
import { useOrg } from '../../hooks/useOrg';
import type { EmailTemplate } from '../../types';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { TemplateEditor } from './TemplateEditor';
import { CategoryBadge, CategoryFilter } from './CategoryControls';
import { distinctCategories, matchesCategory, normalizeCategory } from '../../lib/categories';
import { renderEmailText } from '../../../supabase/functions/_shared/emailFormat';
import { useIcps } from '../../hooks/useIcps';
import { ImportSetupButton } from '../mdImport/ImportSetupButton';
import { CopyTemplatesDialog } from './CopyTemplatesDialog';

/** Template library: defaults first, then own; click to edit (own or admin), New to create. */
export function TemplateList() {
  const { templates, loading, error, save, remove, refresh, copy } = useTemplates();
  const { session } = useAuth();
  const { currentOrg } = useOrg();
  const [editing, setEditing] = useState<EmailTemplate | null | 'new'>(null);
  const [categoryFilter, setCategoryFilter] = useState('');
  const { icps, loading: icpsLoading, error: icpsError, refresh: refreshIcps } = useIcps();
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copyLock = useRef(false);

  async function duplicate(template: EmailTemplate): Promise<string | null> {
    if (copyLock.current) return 'A copy is already being saved.';
    copyLock.current = true;
    setCopyBusy(true); setCopyError(null);
    try { const created = await copy([template]); setEditing(created[0]); return null; }
    catch (error) {
      console.error('Could not duplicate template', { templateId: template.id, error });
      const message = error instanceof Error ? error.message : 'Could not duplicate template. Check the list before trying again.';
      setCopyError(message); return message;
    } finally { copyLock.current = false; setCopyBusy(false); }
  }

  const canEdit = (t: EmailTemplate) => currentOrg?.role === 'admin' || t.created_by === session?.user.id;

  if (loading) return <Skeleton className="h-40 w-full" />;
  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <CategoryFilter
          value={categoryFilter}
          onChange={setCategoryFilter}
          categories={distinctCategories(templates)}
          hasUncategorised={templates.some((t) => normalizeCategory(t.category) === null)}
        />
        <div className="ml-auto flex flex-wrap gap-2">
          <ImportSetupButton label="Import templates" onApplied={async () => { await Promise.all([refresh(), refreshIcps()]); }} />
          <Button variant="secondary" disabled={icpsLoading || !!icpsError || !currentOrg || !session} onClick={() => setCopyOpen(true)}>Copy templates to another ICP</Button>
          <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" aria-hidden />New template</Button>
        </div>
      </div>
      {copyError && <p role="alert" className="text-sm text-danger">{copyError}</p>}
      {icpsError && <p role="alert" className="text-sm text-danger">Could not load customer profiles: {icpsError}</p>}
      {templates.length === 0 && <EmptyState icon={FileText} title="No templates yet" hint="Create your first template to draft emails faster." />}
      <ul className="grid gap-3 md:grid-cols-2">
        {templates.filter((t) => matchesCategory(t, categoryFilter)).map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => canEdit(t) ? setEditing(t) : undefined}
              className={`w-full rounded-xl border border-line bg-card p-4 text-left ${canEdit(t) ? 'cursor-pointer hover:bg-surface/50' : 'cursor-default'}`}>
              <div className="flex items-center gap-2">
                <span className="font-heading text-sm font-bold">{t.name}</span>
                {t.is_default && <Star className="h-3.5 w-3.5 text-warning" aria-label="Default template" />}
                <CategoryBadge category={t.category} />
                {(t.attachments ?? []).length > 0 && (
                  <span className="flex items-center gap-0.5 text-xs text-muted" title={(t.attachments ?? []).map((a) => a.name).join(', ')}>
                    <Paperclip className="h-3.5 w-3.5" aria-hidden /> {(t.attachments ?? []).length}
                  </span>
                )}
                {(t.links ?? []).length > 0 && (
                  <span className="flex items-center gap-0.5 text-xs text-muted" title={(t.links ?? []).map((l) => l.label).join(', ')}>
                    <Link2 className="h-3.5 w-3.5" aria-hidden /> {(t.links ?? []).length}
                  </span>
                )}
              </div>
              <p className="mt-1 truncate text-sm text-muted">{t.subject}</p>
              <p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-xs text-muted">{renderEmailText(t.body)}</p>
            </button>
            <Button variant="ghost" disabled={copyBusy || !session || !currentOrg} aria-label={`Duplicate ${t.name}`} onClick={() => void duplicate(t)}>Duplicate</Button>
          </li>
        ))}
      </ul>
      {editing && (
        <TemplateEditor
          key={editing === 'new' ? 'new' : editing.id}
          template={editing === 'new' ? null : editing}
          isAdmin={currentOrg?.role === 'admin'}
          onSave={(input, id) => save(input, id)}
          onDelete={(id) => remove(id)}
          onClose={() => setEditing(null)}
          onDuplicate={editing === 'new' ? undefined : () => duplicate(editing)}
        />
      )}
      {copyOpen && currentOrg && session && <CopyTemplatesDialog key={currentOrg.id} templates={templates} icps={icps} orgId={currentOrg.id} userId={session.user.id}
        onClose={() => setCopyOpen(false)} onCopy={async (sources, target) => {
          try { await copy(sources, target); return null; }
          catch (error) { console.error('Could not copy template set', { orgId: currentOrg.id, error }); return error instanceof Error ? error.message : 'Could not copy templates. Check the list before trying again.'; }
        }} />}
    </div>
  );
}
