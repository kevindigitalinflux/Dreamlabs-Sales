import { useRef, useState } from 'react';
import { Link2, Video, X } from 'lucide-react';
import { VIDEO_TYPES, normalizeLinkUrl, uploadVideo, validateVideoFile } from '../../lib/emailAttachments';
import type { EmailLink } from '../../lib/emailAttachments';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

interface LinksEditorProps {
  orgId: string;
  links: EmailLink[];
  onChange: (links: EmailLink[]) => void;
}

/** "Price list.mp4" -> "Price list": the default label for an uploaded video's link. */
function labelFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Video';
}

/**
 * Links appended to the end of every email made from a template. A video is just a
 * link: paste a YouTube/Vimeo/Drive URL, or upload a file (up to 50 MB), which is
 * hosted and added as a link. Big videos are links, never attachments.
 */
export function LinksEditor({ orgId, links, onChange }: LinksEditorProps) {
  const videoRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addLink() {
    const clean = normalizeLinkUrl(url);
    if (!clean) { setError('Enter a valid web address, like https://youtu.be/…'); return; }
    onChange([...links, { label: label.trim() || clean, url: clean }]);
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
    onChange([...links, { label: labelFromFilename(file.name), url: hostedUrl }]);
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-1 text-xs font-semibold text-muted"><Link2 className="h-3.5 w-3.5" aria-hidden /> Links and videos</p>
      {links.length > 0 && (
        <ul className="flex flex-col gap-1">
          {links.map((l, i) => (
            <li key={`${l.url}-${i}`} className="flex items-center gap-2 rounded-lg bg-surface/60 px-2 py-1 text-sm">
              <span className="min-w-0 flex-1 truncate"><span className="font-semibold">{l.label}</span> <span className="text-muted">{l.url}</span></span>
              <button
                type="button"
                aria-label={`Remove ${l.label}`}
                onClick={() => onChange(links.filter((_, idx) => idx !== i))}
                className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-surface hover:text-offwhite"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
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
        <span className="text-xs text-muted">MP4, MOV or WebM up to 50 MB. For longer videos paste a YouTube, Vimeo or Drive link.</span>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
