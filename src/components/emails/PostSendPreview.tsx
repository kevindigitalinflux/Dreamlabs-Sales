import type { PostSendReport } from '../../lib/postSendPreview';

interface PostSendPreviewProps {
  /** Preview lines before sending; null shows nothing. */
  lines: string[] | null;
  /** The server's report after sending; replaces the preview. */
  report?: PostSendReport | null;
  multi?: boolean;
}

/** "What happens after sending" before a send, and what actually happened after it (warnings in amber). */
export function PostSendPreview({ lines, report, multi }: PostSendPreviewProps) {
  if (report) {
    return (
      <div role="status" className="flex flex-col gap-1 text-xs text-muted">
        {report.lines.length > 0 && <p className="font-bold uppercase tracking-wide">Updated after sending</p>}
        {report.lines.map((l) => <p key={l}>{l}</p>)}
        {report.warnings.map((w) => <p key={w} className="text-warning">{w}</p>)}
      </div>
    );
  }
  if (!lines || lines.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-surface/60 p-3 text-xs text-muted">
      <p className="font-bold uppercase tracking-wide">What happens after sending</p>
      {lines.map((l) => <p key={l}>{l}</p>)}
      {multi && <p>Applied once for this lead, from the first email sent.</p>}
    </div>
  );
}
