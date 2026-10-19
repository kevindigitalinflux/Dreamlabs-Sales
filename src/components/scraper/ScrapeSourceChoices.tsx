import { SEARCH_SOURCES, SOURCE_NAMES, sourceAvailability, type SearchSource } from '../../lib/scrapeMerge';

interface Props {
  country: string;
  sources: SearchSource[];
  configured: Record<SearchSource, boolean>;
  onChange(sources: SearchSource[]): void;
}

export function ScrapeSourceChoices({ country, sources, configured, onChange }: Props) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="font-semibold">Choose data sources</legend>
      <p className="text-sm text-offwhite">Search selected sources together and review one combined list.</p>
      {SEARCH_SOURCES.map((source) => {
        const reason = sourceAvailability(source, country, configured[source]);
        return (
          <label key={source} className="flex min-h-11 items-start gap-2 py-2">
            <input type="checkbox" checked={!reason && sources.includes(source)} disabled={!!reason}
              onChange={(e) => onChange(e.target.checked ? [...sources, source] : sources.filter((s) => s !== source))}
              aria-describedby={reason ? `source-${source}-reason` : undefined}
              className="mt-1 h-4 w-4 shrink-0 accent-violet-500 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet" />
            <span>{SOURCE_NAMES[source]}{reason && <span id={`source-${source}-reason`} className="block text-sm text-offwhite">{reason}</span>}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
