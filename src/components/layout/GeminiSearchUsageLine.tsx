import { geminiSearchPresentation } from '../../../supabase/functions/_shared/geminiSearchMeter';
import type { GeminiUsageState } from '../../hooks/useGeminiSearchUsage';

/** The monthly count informs users; it never disables a search. */
export function GeminiSearchUsageLine({ state }: { state: GeminiUsageState }) {
  if (state.status === 'idle') return null;
  if (state.status === 'loading') return <p className="mt-2 text-xs text-muted">Checking Gemini searches…</p>;
  if (!state.value) return <p className="mt-2 text-xs text-muted">Gemini search usage unavailable.</p>;
  const shown = geminiSearchPresentation(state.value);
  return <p className={`mt-2 text-xs ${shown.state === 'full' ? 'text-danger' : shown.state === 'warning' ? 'text-warning' : 'text-muted'}`}>{shown.text}</p>;
}
