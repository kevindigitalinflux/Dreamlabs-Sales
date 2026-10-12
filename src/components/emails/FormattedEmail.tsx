import type { ReactNode } from 'react';
import { parseEmail, type Inline } from '../../../supabase/functions/_shared/emailFormat';

interface FormattedEmailProps {
  /** Email body in the marker syntax (**bold**, "- " bullets, "## " headings, [text](url) links). */
  body: string;
  /** Shown instead when the body is empty. */
  emptyText?: string;
  className?: string;
}

function renderInline(pieces: Inline[]): ReactNode[] {
  return pieces.map((p, i) => {
    if (p.kind === 'bold') return <strong key={i} className="font-bold">{p.text}</strong>;
    if (p.kind === 'link') {
      return (
        <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className="break-all text-violet underline">
          {p.text}
        </a>
      );
    }
    return <span key={i}>{p.text}</span>;
  });
}

/**
 * Shows an email body the way it will look in the recipient's inbox: the same
 * parser and rules as the HTML email, rendered as React elements (all text is
 * escaped by React; links only for validated http(s) addresses).
 */
export function FormattedEmail({ body, emptyText = 'Nothing to preview yet', className = '' }: FormattedEmailProps) {
  const blocks = parseEmail(body);
  if (blocks.length === 0) return <p className={`text-sm text-muted ${className}`}>{emptyText}</p>;
  return (
    <div className={`break-words text-[15px] leading-normal ${className}`}>
      {blocks.map((block, i) => {
        if (block.kind === 'heading') {
          return <p key={i} className="mt-4 mb-2 text-[17px] font-bold first:mt-0">{renderInline(block.inline)}</p>;
        }
        if (block.kind === 'list') {
          return (
            <ul key={i} className="mb-3 list-disc pl-[22px]">
              {block.items.map((item, j) => <li key={j} className="mb-1">{renderInline(item)}</li>)}
            </ul>
          );
        }
        return (
          <p key={i} className="mb-3 last:mb-0">
            {block.lines.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {renderInline(line)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
