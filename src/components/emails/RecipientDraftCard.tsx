import { UserRound } from 'lucide-react';
import { appendLinkToBody } from '../../lib/emailAttachments';
import type { RecipientDraft } from '../../lib/composerDrafts';
import { Input, Textarea } from '../ui/Input';
import type { RecipientKind } from '../../lib/composerRecipients';
import { AttachmentFiles } from './AttachmentFiles';
import { InsertLink } from './InsertLink';
import { GeneralInboxTag } from './RecipientPicker';

interface RecipientDraftCardProps {
  /** Who this email is for. */
  name: string | null;
  title: string | null;
  /** A general inbox is tagged so it is not mistaken for a named person. */
  kind?: RecipientKind;
  email: string;
  draft: RecipientDraft;
  onChange: (patch: Partial<RecipientDraft>) => void;
  /** Needed for uploads (files are filed under the organisation). */
  orgId: string | undefined;
}

/**
 * One recipient's own email, shown when several people are ticked: their subject and body
 * (written for them, so editable on their own) plus their own attachments and links. The
 * single-recipient composer view is unchanged; this is only used for two or more.
 */
export function RecipientDraftCard({ name, title, kind, email, draft, onChange, orgId }: RecipientDraftCardProps) {
  const written = draft.subject.trim() !== '' || draft.body.trim() !== '';
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <header className="flex flex-wrap items-center gap-2">
        <UserRound className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        <span className="text-sm font-bold">{name ?? email}</span>
        {kind === 'general' && <GeneralInboxTag />}
        {title && <span className="text-xs text-muted">{title}</span>}
        {name && <span className="text-xs text-muted">{email}</span>}
        {!written && <span className="ml-auto text-xs text-warning">Not written yet</span>}
      </header>
      <Input label="Subject" value={draft.subject} onChange={(e) => onChange({ subject: e.target.value })} />
      <Textarea label="Body" rows={8} value={draft.body} onChange={(e) => onChange({ body: e.target.value })} />
      {draft.missing.length > 0 && (
        <p className="text-xs text-warning">No value for: {draft.missing.map((m) => `{{${m}}}`).join(', ')}. Those spots are blank.</p>
      )}
      {orgId && (
        <details className="rounded-lg bg-surface/40 p-2">
          <summary className="cursor-pointer text-xs font-semibold text-muted">
            Attachments and links{draft.attachments.length > 0 ? ` (${draft.attachments.length} attached)` : ''}
          </summary>
          <div className="mt-2 flex flex-col gap-4">
            <AttachmentFiles orgId={orgId} attachments={draft.attachments} onChange={(attachments) => onChange({ attachments })} compact />
            <InsertLink orgId={orgId} onInsert={(link) => onChange({ body: appendLinkToBody(draft.body, link) })} />
          </div>
        </details>
      )}
    </section>
  );
}
