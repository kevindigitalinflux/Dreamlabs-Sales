import { useRef, useState } from 'react';
import { FileText, Image, Paperclip, X } from 'lucide-react';
import {
  ATTACHMENT_TYPES, MAX_TOTAL_ATTACHMENT_BYTES, formatBytes, uploadAttachment, validateAttachmentFile,
} from '../../lib/emailAttachments';
import type { EmailAttachment } from '../../lib/emailAttachments';
import { Button } from '../ui/Button';

interface AttachmentFilesProps {
  orgId: string;
  attachments: EmailAttachment[];
  onChange: (attachments: EmailAttachment[]) => void;
  /** Hide the "up to 10 MB" helper copy where space is tight (the composer). */
  compact?: boolean;
}

/**
 * Attached files (PDF, PNG, JPEG) with upload and remove. Used by the template editor
 * and the email composer. Removing only detaches the file: the stored copy is kept
 * because drafts made earlier from the same template still point at it.
 */
export function AttachmentFiles({ orgId, attachments, onChange, compact = false }: AttachmentFilesProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = attachments.reduce((sum, a) => sum + a.size, 0);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    let next = [...attachments];
    let runningTotal = total;
    for (const file of Array.from(files)) {
      const problem = validateAttachmentFile(file, runningTotal);
      if (problem) { setError(problem); continue; }
      const { attachment, error: uploadError } = await uploadAttachment(orgId, file);
      if (uploadError || !attachment) { setError(`${file.name}: ${uploadError ?? 'upload failed'}`); continue; }
      next = [...next, attachment];
      runningTotal += attachment.size;
    }
    onChange(next);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-1 text-xs font-semibold text-muted">
        <Paperclip className="h-3.5 w-3.5" aria-hidden /> Attachments
        {attachments.length > 0 && <span className="font-normal">({formatBytes(total)} of {formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)})</span>}
      </p>
      {attachments.length > 0 && (
        <ul className="flex flex-col gap-1">
          {attachments.map((a) => {
            const Icon = a.type === 'application/pdf' ? FileText : Image;
            return (
              <li key={a.path} className="flex items-center gap-2 rounded-lg bg-surface/60 px-2 py-1 text-sm">
                <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                <span className="shrink-0 text-xs text-muted">{formatBytes(a.size)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => onChange(attachments.filter((x) => x.path !== a.path))}
                  className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-surface hover:text-offwhite"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ATTACHMENT_TYPES.join(',')}
          onChange={(e) => void handleFiles(e.target.files)}
          className="hidden"
        />
        <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy} loading={busy}>
          {busy ? 'Uploading…' : 'Attach file'}
        </Button>
        {!compact && <span className="text-xs text-muted">PDF, PNG or JPEG, up to {formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)} in total per email.</span>}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
