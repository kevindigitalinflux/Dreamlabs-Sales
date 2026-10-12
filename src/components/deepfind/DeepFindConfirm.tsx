import { Input } from '../ui/Input';
import { DEEP_FIND_CAP_LIMITS } from '../../lib/deepFindView';

interface DeepFindConfirmProps {
  leadCount: number;
  hunterCap: string;
  aiCap: string;
  onHunterCap: (value: string) => void;
  onAiCap: (value: string) => void;
  capError: string | null;
}

/** What Deep find will do and the editable credit caps, shown before it starts. */
export function DeepFindConfirm({ leadCount, hunterCap, aiCap, onHunterCap, onAiCap, capError }: DeepFindConfirmProps) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>Deep find searches {leadCount === 1 ? 'this lead' : `${leadCount} leads`} in the background. For each one it:</p>
      <ul className="ml-5 list-disc text-muted">
        <li>looks for the company&apos;s other website and email domains</li>
        <li>lists the people Hunter knows at those domains (up to 10 per domain)</li>
        <li>adds Companies House officers and looks for their emails</li>
        <li>reads the team and about pages, and runs one web search</li>
      </ul>
      <p className="text-muted">
        People it finds on the company&apos;s confirmed domains are added as contacts with their source shown. They are never emailed and never added to
        follow-up sequences until you switch them on. People found only on a domain it could not confirm, or named only by the web search or the website, are listed for you to check.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Input label={`Hunter credits (max ${DEEP_FIND_CAP_LIMITS.hunter})`} inputMode="numeric" value={hunterCap} onChange={(e) => onHunterCap(e.target.value)} />
        <Input label={`AI calls (max ${DEEP_FIND_CAP_LIMITS.ai})`} inputMode="numeric" value={aiCap} onChange={(e) => onAiCap(e.target.value)} />
      </div>
      <p className="text-xs text-muted">The caps cover the whole run. Each Hunter search uses about one Hunter credit. When a cap is reached, Deep find stops using that service and says so.</p>
      {capError && <p role="alert" className="text-sm text-danger">{capError}</p>}
    </div>
  );
}
