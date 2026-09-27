import { useState } from 'react';
import { Copy, Eye } from 'lucide-react';
import { usePipeline } from '../../hooks/usePipeline';
import { usePipelineActions } from '../../hooks/usePipelineActions';
import { usePipelinePermission } from '../../hooks/usePipelinePermission';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../ui/Button';

/**
 * Persistent banner shown whenever the active pipeline isn't owned by the current
 * user — a prominent "Make my own copy" CTA for edit-shared pipelines, a plain
 * read-only notice for view-shared ones. Renders nothing for an owned or default
 * pipeline (usePipelinePermission returns null in both cases).
 */
export function SharedPipelineBanner() {
  const { currentPipeline, switchPipeline } = usePipeline();
  const { session } = useAuth();
  const { forkPipeline } = usePipelineActions();
  const [forking, setForking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOwnedOrDefault = !currentPipeline || currentPipeline.created_by === session?.user.id || currentPipeline.is_default;
  const permission = usePipelinePermission(isOwnedOrDefault ? null : currentPipeline!.id);
  if (!permission || !currentPipeline) return null;

  async function handleFork() {
    if (!currentPipeline) return;
    setForking(true);
    setError(null);
    const { error: err, pipeline: forked } = await forkPipeline(currentPipeline);
    setForking(false);
    if (err) { setError(err); return; }
    if (forked) switchPipeline(forked.id);
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-cyan/40 bg-cyan/10 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Eye className="h-4 w-4 text-cyan" aria-hidden />
          {permission === 'edit'
            ? "You're viewing a pipeline shared with you. Fork it to work your own copy."
            : "You're viewing a shared pipeline (read-only)."}
        </div>
        {permission === 'edit' && (
          <Button onClick={() => void handleFork()} disabled={forking} loading={forking}>
            <Copy className="h-4 w-4" aria-hidden />
            {forking ? 'Copying…' : 'Make my own copy'}
          </Button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
