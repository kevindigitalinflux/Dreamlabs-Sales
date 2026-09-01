import { ExternalLink } from 'lucide-react';

interface ProviderGuideProps {
  /** Provider's key-creation / console page. Opens in a new tab. */
  url: string;
  /** Action-oriented button label, e.g. "Get your free Gemini API key →". */
  ctaLabel: string;
  /** Plain-English framing: cost, one-time-per-org setup, who usage bills to. */
  freeText: string;
  /** Optional short numbered walkthrough for non-technical admins. */
  steps?: string[];
}

/**
 * Self-service setup guidance for one BYO API-key provider row: a get-the-key
 * button that opens the provider's console in a new tab, plain-English
 * framing (cost / one-time-per-org / who pays), and an optional numbered
 * mini-guide. Sits above the existing password input + Save button — it does
 * not touch save/validation behaviour.
 */
export function ProviderGuide({ url, ctaLabel, freeText, steps }: ProviderGuideProps) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted">{freeText}</p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 w-fit cursor-pointer items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 text-[15px] font-semibold text-offwhite transition-colors hover:bg-surface/70"
      >
        {ctaLabel}
        <ExternalLink className="h-4 w-4" aria-hidden />
      </a>
      {steps && steps.length > 0 && (
        <ol className="flex flex-col gap-2 rounded-lg bg-surface/60 p-4 text-sm">
          {steps.map((s, i) => (
            <li key={s} className="flex gap-2">
              <span className="font-bold text-cyan">{i + 1}.</span>{s}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
