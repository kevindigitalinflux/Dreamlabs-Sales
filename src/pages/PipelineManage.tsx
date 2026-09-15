import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Copy, Plus } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { usePipeline } from '../hooks/usePipeline';
import { usePipelineActions } from '../hooks/usePipelineActions';
import { usePipelineShares } from '../hooks/usePipelineShares';
import { useProfiles } from '../hooks/useProfiles';
import { useOrg } from '../hooks/useOrg';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import { PipelineCard } from '../components/pipeline/PipelineCard';
import type { Pipeline, PipelinePermission } from '../types';

/** Create/rename/delete pipelines you can manage (your own, or any in your org if
 * you're an org admin — mirroring can_edit_pipeline's server-side rule), manage
 * their shares, and act on shares granted to you (view, or fork into your own copy). */
export function PipelineManage() {
  const { session } = useAuth();
  const { currentOrg } = useOrg();
  const { pipelines, loading: pipelinesLoading, switchPipeline } = usePipeline();
  const { profiles, error: profilesError } = useProfiles();
  const { createPipeline, renamePipeline, deletePipeline, shareWithinOrg, revokeShare, forkPipeline } = usePipelineActions();
  const navigate = useNavigate();

  // Mirrors the server-side can_edit_pipeline rule (org admin OR creator) — a UI
  // convenience only, RLS is still the real gate on every action. The default
  // pipeline (created_by is always NULL) is never manageable by a non-admin here;
  // they still see/work its leads via Kanban/List, gated by can_view_pipeline
  // instead, which does carry the is_default carve-out for read visibility.
  const canManage = currentOrg?.role === 'admin'
    ? (p: Pipeline) => p.org_id === currentOrg.id
    : (p: Pipeline) => p.org_id === currentOrg?.id && p.created_by === session?.user.id;
  const owned = pipelines.filter(canManage);
  const ownedIds = owned.map((p) => p.id);
  const { outgoing, incoming, loading: sharesLoading, error: sharesError, refresh: refreshShares } = usePipelineShares(ownedIds);

  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<Record<string, string>>({});
  const [sharePermission, setSharePermission] = useState<Record<string, PipelinePermission>>({});
  const [crossOrgEmail, setCrossOrgEmail] = useState<Record<string, string>>({});
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

  async function handleShareCrossOrg(pipeline: Pipeline) {
    const email = crossOrgEmail[pipeline.id];
    const permission = sharePermission[pipeline.id] ?? 'view';
    if (!email) return;
    const { data, error: invokeErr } = await supabase.functions.invoke('pipeline-shares', {
      body: { action: 'share_cross_org', pipeline_id: pipeline.id, email, permission },
    });
    if (invokeErr) { setError(invokeErr.message); return; }
    const result = data as { error?: string };
    if (result.error) { setError(result.error); return; }
    setCrossOrgEmail((prev) => ({ ...prev, [pipeline.id]: '' }));
    await refreshShares();
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

  const bannerError = error || profilesError || sharesError;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <h1 className="text-[28px] font-extrabold">Manage pipelines</h1>
      {bannerError && <p role="alert" className="text-sm text-danger">{bannerError}</p>}

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
            <PipelineCard
              key={pipeline.id}
              pipeline={pipeline}
              shares={outgoing[pipeline.id] ?? []}
              profiles={profiles}
              shareTarget={shareTarget[pipeline.id] ?? ''}
              sharePermission={sharePermission[pipeline.id] ?? 'view'}
              crossOrgEmail={crossOrgEmail[pipeline.id] ?? ''}
              busy={busyId === pipeline.id}
              onShareTargetChange={(userId) => setShareTarget((prev) => ({ ...prev, [pipeline.id]: userId }))}
              onSharePermissionChange={(permission) => setSharePermission((prev) => ({ ...prev, [pipeline.id]: permission }))}
              onCrossOrgEmailChange={(email) => setCrossOrgEmail((prev) => ({ ...prev, [pipeline.id]: email }))}
              onRename={() => void handleRename(pipeline)}
              onDelete={() => void handleDelete(pipeline)}
              onShare={() => void handleShare(pipeline)}
              onShareCrossOrg={() => void handleShareCrossOrg(pipeline)}
              onRevoke={(shareId) => void handleRevoke(shareId)}
            />
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
