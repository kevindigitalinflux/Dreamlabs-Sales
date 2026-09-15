import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Copy, Plus, Share2, Trash2, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { usePipeline } from '../hooks/usePipeline';
import { usePipelineActions } from '../hooks/usePipelineActions';
import { usePipelineShares } from '../hooks/usePipelineShares';
import { useProfiles } from '../hooks/useProfiles';
import { useOrg } from '../hooks/useOrg';
import { Button } from '../components/ui/Button';
import { Input, SelectField } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import type { Pipeline, PipelinePermission } from '../types';

/** Create/rename/delete pipelines you can manage (your own, or any in your org if
 * you're an org admin — mirroring can_edit_pipeline's server-side rule), manage
 * their shares, and act on shares granted to you (view, or fork into your own copy). */
export function PipelineManage() {
  const { session } = useAuth();
  const { currentOrg } = useOrg();
  const { pipelines, loading: pipelinesLoading, switchPipeline } = usePipeline();
  const { profiles } = useProfiles();
  const { createPipeline, renamePipeline, deletePipeline, shareWithinOrg, revokeShare, forkPipeline } = usePipelineActions();
  const navigate = useNavigate();

  // Mirrors the server-side can_edit_pipeline rule (org admin OR creator OR
  // default) — a UI convenience only, RLS is still the real gate on every action.
  const canManage = currentOrg?.role === 'admin'
    ? (p: Pipeline) => p.org_id === currentOrg.id
    : (p: Pipeline) => p.org_id === currentOrg?.id && (p.is_default || p.created_by === session?.user.id);
  const owned = pipelines.filter(canManage);
  const ownedIds = owned.map((p) => p.id);
  const { outgoing, incoming, loading: sharesLoading, refresh: refreshShares } = usePipelineShares(ownedIds);

  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<Record<string, string>>({});
  const [sharePermission, setSharePermission] = useState<Record<string, PipelinePermission>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    const err = await createPipeline(newName);
    if (err) setError(err);
    else setNewName('');
  }

  async function handleRename(pipeline: Pipeline) {
    const name = window.prompt('Rename pipeline', pipeline.name);
    if (!name) return;
    const err = await renamePipeline(pipeline.id, name);
    if (err) setError(err);
  }

  async function handleDelete(pipeline: Pipeline) {
    setBusyId(pipeline.id);
    const err = await deletePipeline(pipeline.id);
    setBusyId(null);
    if (err) setError(err);
  }

  async function handleShare(pipeline: Pipeline) {
    const userId = shareTarget[pipeline.id];
    const permission = sharePermission[pipeline.id] ?? 'view';
    if (!userId) return;
    const err = await shareWithinOrg(pipeline.id, userId, permission);
    if (err) setError(err);
    else await refreshShares();
  }

  async function handleRevoke(shareId: string) {
    const err = await revokeShare(shareId);
    if (err) setError(err);
    else await refreshShares();
  }

  async function handleFork(pipeline: Pipeline) {
    setBusyId(pipeline.id);
    const { error: err, pipeline: forked } = await forkPipeline(pipeline);
    setBusyId(null);
    if (err) { setError(err); return; }
    if (forked) { switchPipeline(forked.id); navigate('/pipeline/kanban'); }
  }

  if (pipelinesLoading || sharesLoading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <h1 className="text-[28px] font-extrabold">Manage pipelines</h1>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">Your pipelines</h2>
        <div className="flex items-end gap-3">
          <Input label="New pipeline name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Button onClick={() => void handleCreate()}>
            <Plus className="h-4 w-4" aria-hidden />
            Create
          </Button>
        </div>
        <ul className="flex flex-col gap-3">
          {owned.map((pipeline) => (
            <li key={pipeline.id} className="rounded-xl border border-line bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">
                  {pipeline.name}
                  {pipeline.is_default && <span className="ml-2 text-xs text-muted">(default — can't be deleted)</span>}
                </span>
                {!pipeline.is_default && (
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => void handleRename(pipeline)}>Rename</Button>
                    <Button variant="danger" onClick={() => void handleDelete(pipeline)} disabled={busyId === pipeline.id}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                )}
              </div>
              <ul className="mt-3 flex flex-col gap-1">
                {(outgoing[pipeline.id] ?? []).map((share) => (
                  <li key={share.id} className="flex items-center justify-between text-sm text-muted">
                    <span>{share.profiles.full_name ?? share.profiles.email} — {share.permission}</span>
                    <button type="button" onClick={() => void handleRevoke(share.id)} aria-label="Revoke access" className="cursor-pointer hover:text-danger">
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-end gap-2">
                <SelectField
                  label="Share with"
                  value={shareTarget[pipeline.id] ?? ''}
                  onChange={(e) => setShareTarget((prev) => ({ ...prev, [pipeline.id]: e.target.value }))}
                >
                  <option value="">Choose teammate…</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>
                  ))}
                </SelectField>
                <SelectField
                  label="Permission"
                  value={sharePermission[pipeline.id] ?? 'view'}
                  onChange={(e) => setSharePermission((prev) => ({ ...prev, [pipeline.id]: e.target.value as PipelinePermission }))}
                >
                  <option value="view">View</option>
                  <option value="edit">Edit (can fork)</option>
                </SelectField>
                <Button variant="secondary" onClick={() => void handleShare(pipeline)}>
                  <Share2 className="h-4 w-4" aria-hidden />
                  Share
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">Shared with you</h2>
        {incoming.length === 0 && <p className="text-sm text-muted">Nothing shared with you yet.</p>}
        <ul className="flex flex-col gap-3">
          {incoming.map((share) => (
            <li key={share.id} className="flex items-center justify-between rounded-xl border border-line bg-card p-4">
              <span className="font-semibold">{share.pipelines.name} — {share.permission}</span>
              {share.permission === 'edit' && (
                <Button onClick={() => void handleFork(share.pipelines)} disabled={busyId === share.pipelines.id}>
                  <Copy className="h-4 w-4" aria-hidden />
                  Make my own copy
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
