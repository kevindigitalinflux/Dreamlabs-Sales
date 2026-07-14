import { MailCheck } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';

/** Sequence drafts awaiting review — populated by the cycle-2 check-sequences cron. */
export function EmailReviewQueue({ draftCount }: { draftCount: number | null }) {
  if (draftCount === null) return null;
  return (
    <EmptyState
      icon={MailCheck}
      title={draftCount === 0 ? 'No emails waiting for review' : `${draftCount} draft(s) waiting`}
      hint="AI-drafted sequence emails will queue here for your approval once Email Automation lands (cycle 2)."
    />
  );
}
