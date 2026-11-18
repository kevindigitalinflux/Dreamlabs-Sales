import { Eye, Paperclip } from 'lucide-react';
import { FormattedEmail } from './FormattedEmail';

interface EmailPreviewPaneProps {
  /** Recipient shown on the To line; a sample name or address is fine for templates. */
  to?: string;
  subject: string;
  body: string;
  /** Links added to the email, already in the marker syntax (see `linksBlock`). */
  linksText?: string;
  attachmentNames?: string[];
  /** Small note under the title, e.g. "Sample lead". */
  caption?: string;
}

/** The email as it will arrive: To and Subject lines, then the body, links and attachments. Updates as the user types. */
export function EmailPreviewPane({ to, subject, body, linksText, attachmentNames = [], caption }: EmailPreviewPaneProps) {
  return (
    <section aria-label="How the email will look" className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-0">
      <p className="flex items-center gap-2 text-sm font-semibold text-muted">
        <span className="flex h-7 w-7 items-center justify-center rounded-nested bg-violet-soft text-link"><Eye className="h-4 w-4" aria-hidden /></span>
        How it will look{caption ? <span className="font-normal">, {caption}</span> : null}
      </p>
      <div className="overflow-hidden rounded-surface border border-line bg-card shadow-raised">
        <dl className="grid grid-cols-[3.5rem_1fr] gap-x-3 gap-y-1.5 border-b border-line bg-surface px-4 py-3 text-sm">
          {to !== undefined && <><dt className="text-muted">To</dt><dd className="min-w-0 break-words">{to || 'No recipient yet'}</dd></>}
          <dt className="text-muted">Subject</dt>
          <dd className="min-w-0 break-words font-semibold">{subject || 'No subject yet'}</dd>
        </dl>
        <div className="px-4 py-4">
          <FormattedEmail body={body} />
          {linksText && <FormattedEmail body={linksText} className="mt-3" />}
        </div>
        {attachmentNames.length > 0 && (
          <p className="flex items-start gap-2 border-t border-line px-4 py-3 text-sm text-muted">
            <Paperclip className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span className="break-words">{attachmentNames.join(', ')}</span>
          </p>
        )}
      </div>
    </section>
  );
}
