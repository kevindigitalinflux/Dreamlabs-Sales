import { ChevronDown, GitBranch } from 'lucide-react';
import { Link } from 'react-router';
import { useOrg } from '../../hooks/useOrg';
import { usePipeline } from '../../hooks/usePipeline';

/**
 * Pipeline switcher + "Manage" link. The dropdown itself only renders once there's
 * something to switch between (2+ pipelines) — but the "Manage" link always renders
 * regardless, since it's the only route to /pipeline/manage anywhere in the app: hiding
 * it whenever an org has just its one Default Pipeline would make the page where a
 * second pipeline gets created permanently unreachable for that org.
 */
export function PipelineSwitcher() {
  const { currentOrg, orgs } = useOrg();
  const { currentPipeline, pipelines, switchPipeline } = usePipeline();

  const owned = pipelines.filter((p) => p.org_id === currentOrg?.id);
  const shared = pipelines.filter((p) => p.org_id !== currentOrg?.id);

  function orgNameFor(orgId: string): string {
    return orgs.find((o) => o.id === orgId)?.name ?? 'Shared pipeline';
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <GitBranch className="h-4 w-4 text-muted" aria-hidden />
      {pipelines.length > 1 && (
        <div className="relative">
          <select
            aria-label="Current pipeline"
            value={currentPipeline?.id ?? ''}
            onChange={(e) => switchPipeline(e.target.value)}
            className="min-h-11 cursor-pointer appearance-none rounded-lg border border-line bg-surface py-2 pl-2 pr-8 text-sm font-semibold outline-none focus:border-violet"
          >
            <optgroup label="Your org">
              {owned.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </optgroup>
            {shared.length > 0 && (
              <optgroup label="Shared with you">
                {shared.map((p) => <option key={p.id} value={p.id}>{p.name} — {orgNameFor(p.org_id)}</option>)}
              </optgroup>
            )}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        </div>
      )}
      <Link to="/pipeline/manage" className="text-xs font-semibold text-cyan hover:underline">Manage</Link>
    </label>
  );
}
