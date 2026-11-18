import { Paperclip, UserRound } from 'lucide-react';
import { Collapsible } from '../ui/Collapsible';
import { appendLinkToBody } from '../../lib/emailAttachments';
import type { RecipientDraft } from '../../lib/composerDrafts';
import { Input } from '../ui/Input';
import type { RecipientKind } from '../../lib/composerRecipients';
import { AttachmentFiles } from './AttachmentFiles';
import { InsertLink } from './InsertLink';
import { EmailTextEditor } from './EmailTextEditor';
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
  /** This card is the one shown in the preview pane. */
  active?: boolean;
  /** Called when the user clicks or focuses anything in the card, to show this email in the preview pane. */
  onActivate?: () => void;
}

/**
 * One recipient's own email, shown when several people are ticked: their subject and body
 * (written for them, so editable on their own) plus their own attachments and links. The
 * single-recipient composer view is unchanged; this is only used for two or more.
 */
export function RecipientDraftCard({ name, title, kind, email, draft, onChange, orgId, active = false, onActivate }: RecipientDraftCardProps) {
  const written = draft.subject.trim() !== '' || draft.body.trim() !== '';
  return (
    <section onClick={onActivate} onFocusCapture={onActivate} className={`flex flex-col gap-3 rounded-surface border border-l-4 border-line bg-raised p-4 shadow-raised ${active ? 'border-l-violet-line' : 'border-l-line'}`}>
      <header className="flex flex-wrap items-center gap-2">
        <UserRound className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        <span className="text-sm font-bold">{name ?? email}</span>
        {kind === 'general' && <GeneralInboxTag />}
        {title && <span className="text-xs text-muted">{title}</span>}
        {name && <span className="text-xs text-muted">{email}</span>}
        {!written && <span className="ml-auto text-xs text-warning">Not written yet</span>}
      </header>
      <Input label="Subject" value={draft.subject} onChange={(e) => onChange({ subject: e.target.value })} />
      <EmailTextEditor label="Body" rows={8} value={draft.body} onChange={(body) => onChange({ body })} showPreview={false} />
      {draft.missing.length > 0 && (
        <p className="text-xs text-warning">No value for: {draft.missing.map((m) => `{{${m}}}`).join(', ')}. Those spots are blank.</p>
      )}
      {orgId && (
        <Collapsible flat icon={Paperclip} title="Attachments and links" summary={draft.attachments.length > 0 ? `${draft.attachments.length} attached` : 'None yet'}>
          <div className="flex flex-col gap-4">
            <AttachmentFiles orgId={orgId} attachments={draft.attachments} onChange={(attachments) => onChange({ attachments })} compact />
            <InsertLink orgId={orgId} onInsert={(link) => onChange({ body: appendLinkToBody(draft.body, link) })} />
          </div>
        </Collapsible>
      )}
    </section>
  );
}
