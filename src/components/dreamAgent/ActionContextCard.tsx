import {useState} from 'react';
import {Building2} from 'lucide-react';
import {Button} from '../ui/Button';
import {Textarea} from '../ui/Input';
import {ConfirmActionButton} from './ConfirmActionButton';
import type {ActionRowProps} from './ActionRowTypes';
export function ActionContextCard({action,resolution,isOrgAdmin,onResolve,onBulkReady}:ActionRowProps) {
 const [editedContext,setEditedContext]=useState(action.type==='update_company_context'?action.proposed_context:'');
  if (action.type === 'update_company_context') {
    const confirmed = resolution.status === 'confirmed_update_company_context';
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4">
        <p className="flex items-center gap-2 text-sm font-semibold"><Building2 className="h-4 w-4 text-cyan" aria-hidden />Update company context</p>
        <p className="text-xs text-muted">{action.rationale}</p>
        <Textarea
          label="Updated company context"
          value={editedContext}
          onChange={(e) => setEditedContext(e.target.value)}
          rows={6}
          disabled={!isOrgAdmin}
        />
        {!isOrgAdmin && (
          <p className="text-xs text-muted">Only an org admin can apply this — flag it to your admin, or dismiss it.</p>
        )}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => onResolve({ status: 'dismissed' })}>Dismiss</Button>
          {isOrgAdmin && (
            <ConfirmActionButton onReady={onBulkReady}
              variant={confirmed ? 'secondary' : 'primary'}
              disabled={!editedContext.trim()}
              onClick={() => onResolve({ status: 'confirmed_update_company_context', edited_context: editedContext })}
            >
              {confirmed ? 'Confirmed ✓' : 'Confirm'}
            </ConfirmActionButton>
          )}
        </div>
      </div>
    );
  }

return null;
}
