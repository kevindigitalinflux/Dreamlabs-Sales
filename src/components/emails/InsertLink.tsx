import { useRef, useState } from 'react';
import { Link2, Video } from 'lucide-react';
import { VIDEO_TYPES, normalizeLinkUrl, uploadVideo, validateVideoFile } from '../../lib/emailAttachments';
import type { EmailLink } from '../../lib/emailAttachments';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

interface InsertLinkProps {
  orgId: string;
  /** Called with the finished link; the composer appends it to the email body. */
  onInsert: (link: EmailLink) => void;
}

/**
 * Adds a link, or an uploaded video (hosted, up to 50 MB, added as a link), to the
 * email being written. Unlike a template's links, these go straight into the body
 * text, where they can still be reworded or removed like any other line.
 */
export function InsertLink({ orgId, onInsert }: InsertLinkProps) {
  const videoRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addLink() {
    const clean = normalizeLinkUrl(url);
    if (!clean) { setError('Enter a valid web address, like https://youtu.be/…'); return; }
    onInsert({ label: label.trim() || clean, url: clean });
    setLabel('');
    setUrl('');
    setError(null);
  }

  async function handleVideo(file: File | undefined) {
    if (!file) return;
    const problem = validateVideoFile(file);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    const { url: hostedUrl, error: uploadError } = await uploadVideo(orgId, file);
    setBusy(false);
    if (videoRef.current) videoRef.current.value = '';
    if (uploadError || !hostedUrl) { setError(`${file.name}: ${uploadError ?? 'upload failed'}`); return; }
    onInsert({ label: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Video', url: hostedUrl });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-1 text-xs font-semibold text-muted"><Link2 className="h-3.5 w-3.5" aria-hidden /> Add a link or video to this email</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input label="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Price list video" />
        <Input label="Web address" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }} placeholder="https://" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={addLink} disabled={!url.trim()}>Add link</Button>
        <input ref={videoRef} type="file" accept={VIDEO_TYPES.join(',')} onChange={(e) => void handleVideo(e.target.files?.[0])} className="hidden" />
        <Button variant="secondary" onClick={() => videoRef.current?.click()} disabled={busy} loading={busy}>
          <Video className="h-4 w-4" aria-hidden />
          {busy ? 'Uploading…' : 'Upload a video'}
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
