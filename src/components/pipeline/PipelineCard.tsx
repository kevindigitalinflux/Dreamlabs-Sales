import { Share2, Trash2, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input, SelectField } from '../ui/Input';
import type { OutgoingShare } from '../../hooks/usePipelineShares';
import type { OrgProfile } from '../../hooks/useProfiles';
import type { Pipeline, PipelinePermission } from '../../types';

interface PipelineCardProps {
  pipeline: Pipeline;
  shares: OutgoingShare[];
  profiles: OrgProfile[];
  shareTarget: string;
  sharePermission: PipelinePermission;
  crossOrgEmail: string;
  busy: boolean;
  onShareTargetChange: (userId: string) => void;
  onSharePermissionChange: (permission: PipelinePermission) => void;
  onCrossOrgEmailChange: (email: string) => void;
  onRename: () => void;
  onDelete: () => void;
  onShare: () => void;
  onShareCrossOrg: () => void;
  onRevoke: (shareId: string) => void;
}

/** One manageable pipeline: name/rename/delete header, its outgoing shares, the
 * within-org share form, and the cross-org (admin-to-admin, by email) share form.
 * Rename/delete are hidden for the default pipeline. */
export function PipelineCard({
  pipeline,
  shares,
  profiles,
  shareTarget,
  sharePermission,
  crossOrgEmail,
  busy,
  onShareTargetChange,
  onSharePermissionChange,
  onCrossOrgEmailChange,
  onRename,
  onDelete,
  onShare,
  onShareCrossOrg,
  onRevoke,
}: PipelineCardProps) {
  return (
    <li className="rounded-xl border border-line bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">
          {pipeline.name}
          {pipeline.is_default && <span className="ml-2 text-xs text-muted">(default — can't be deleted)</span>}
        </span>
        {!pipeline.is_default && (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onRename}>Rename</Button>
            <Button variant="danger" onClick={onDelete} disabled={busy}>
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        )}
      </div>
      <ul className="mt-3 flex flex-col gap-1">
        {shares.map((share) => (
          <li key={share.id} className="flex items-center justify-between text-sm text-muted">
            <span>{share.profiles.full_name ?? share.profiles.email} — {share.permission}</span>
            <button type="button" onClick={() => onRevoke(share.id)} aria-label="Revoke access" className="cursor-pointer hover:text-danger">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {!pipeline.is_default && (
        <div className="mt-3 flex items-end gap-2">
          <SelectField
            label="Share with"
            value={shareTarget}
            onChange={(e) => onShareTargetChange(e.target.value)}
          >
            <option value="">Choose teammate…</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>
            ))}
          </SelectField>
          <SelectField
            label="Permission"
            value={sharePermission}
            onChange={(e) => onSharePermissionChange(e.target.value as PipelinePermission)}
          >
            <option value="view">View</option>
            <option value="edit">Edit (can fork)</option>
          </SelectField>
          <Button variant="secondary" onClick={onShare}>
            <Share2 className="h-4 w-4" aria-hidden />
            Share
          </Button>
        </div>
      )}
      {!pipeline.is_default && (
        <div className="mt-2 flex items-end gap-2">
          <Input
            label="Or share with an admin in another org (by email)"
            type="email"
            value={crossOrgEmail}
            onChange={(e) => onCrossOrgEmailChange(e.target.value)}
          />
          <Button variant="secondary" onClick={onShareCrossOrg}>
            <Share2 className="h-4 w-4" aria-hidden />
            Share
          </Button>
        </div>
      )}
    </li>
  );
}
