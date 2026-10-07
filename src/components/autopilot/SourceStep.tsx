import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import type { ScrapeSource } from '../../types';

interface Props {
  source: ScrapeSource;
  onSource: (s: ScrapeSource) => void;
  placesConfigured: boolean;
  sourceUnavailable: boolean;
  onBack: () => void;
  onNext: () => void;
}

/** Discover-mode step 2: choose the single data source. */
export function SourceStep({ source, onSource, placesConfigured, sourceUnavailable, onBack, onNext }: Props) {
  return (
    <Card>
      <div className="flex flex-col gap-3">
        <p className="font-semibold">Choose one data source</p>
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" name="autopilot-source" checked={source === 'google_places'} onChange={() => onSource('google_places')} disabled={!placesConfigured} className="h-4 w-4 accent-violet-500" />
          Google Places {!placesConfigured && <span className="text-xs text-muted">(no key configured)</span>}
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" name="autopilot-source" checked={source === 'companies_house'} onChange={() => onSource('companies_house')} disabled className="h-4 w-4 accent-violet-500" />
          Companies House <span className="text-xs text-muted">(not yet supported for autopilot — no contact details available from this source)</span>
        </label>
        <div className="flex justify-between">
          <Button variant="secondary" onClick={onBack}>Back</Button>
          <Button onClick={onNext} disabled={sourceUnavailable}>Continue</Button>
        </div>
      </div>
    </Card>
  );
}
