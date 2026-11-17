import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Phone, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import { useOrgLeads } from '../hooks/useOrgLeads';
import { useAuth } from '../hooks/useAuth';
import { useDialerSettings } from '../hooks/useDialerSettings';
import { filterDialableLeads } from '../lib/dialerFilters';
import type { DialerFilters } from '../lib/dialerFilters';
import { STAGES } from '../lib/utils';
import type { Stage } from '../types';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { SectionTitle } from '../components/ui/SectionTitle';
import { SelectField } from '../components/ui/Input';
import { MultiSelect } from '../components/ui/MultiSelect';
import { Skeleton } from '../components/ui/Skeleton';
import { ToggleChip } from '../components/ui/ToggleChip';

const DEFAULT_STAGES: Stage[] = STAGES.map((s) => s.value).filter((s) => s !== 'won' && s !== 'lost');

/**
 * Power dialer session setup: filter callable leads, see the count. Live dialing arrives once a
 * provider (JustCall/Kixie/Aircall) is connected and dialer-push-queue is built — see
 * docs/superpowers/specs/2026-09-07-calling-integration-design.md.
 */
export function PowerDialer() {
  const { leads, loading } = useOrgLeads();
  const { session } = useAuth();
  const { settings, loading: settingsLoading } = useDialerSettings();

  const [filters, setFilters] = useState<DialerFilters>({
    stages: DEFAULT_STAGES,
    notCalledInDays: 7,
    assignedToMeOnly: true,
  });

  const matching = useMemo(
    () => filterDialableLeads(leads, filters, session?.user.id),
    [leads, filters, session],
  );

  if (loading) return <Skeleton className="h-96 w-full max-w-2xl" />;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-[28px] font-bold">Power dialer</h1>
      <p className="text-muted">Pick who to call, see how many leads match, then start a session.</p>
      <div className="flex items-start gap-3 rounded-surface border border-l-4 border-line border-l-warning bg-raised p-4 text-sm shadow-raised">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
        <p>Business numbers only. Before cold calling in the UK, check TPS/CTPS and any opt-outs. Sole traders and partnerships need extra care.</p>
      </div>

      <Card>
        <div className="mb-3"><SectionTitle icon={SlidersHorizontal}>Who to call</SectionTitle></div>
        <div className="flex flex-wrap items-end gap-3">
          <MultiSelect
            label="Stage"
            options={STAGES.map((s) => ({ value: s.value, label: s.label }))}
            selected={filters.stages}
            onChange={(stages) => setFilters((f) => ({ ...f, stages: stages as Stage[] }))}
          />
          <div className="w-40">
            <SelectField
              label="Not called in the last"
              value={String(filters.notCalledInDays)}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  notCalledInDays: e.target.value === 'any' ? 'any' : (Number(e.target.value) as 7 | 14 | 30),
                }))
              }
            >
              <option value="any">Any time</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
            </SelectField>
          </div>
          <ToggleChip pressed={filters.assignedToMeOnly} onPressedChange={(assignedToMeOnly) => setFilters((f) => ({ ...f, assignedToMeOnly }))}>
            Assigned to me only
          </ToggleChip>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col items-center gap-2 pb-2 pt-4 text-center">
          <span className="font-heading text-5xl font-bold text-link">{matching.length}</span>
          <span className="text-muted">{matching.length === 1 ? 'lead has' : 'leads have'} a phone number and match these filters</span>
        </div>
        <div className="flex flex-col items-center gap-3 py-2 text-center">

          <Button disabled className="w-full max-w-xs">
            <Phone className="h-5 w-5" aria-hidden />
            Start dialing session
          </Button>
          <p className="text-sm text-muted">
            {!settingsLoading && !settings ? (
              <>
                Connect a dialer provider in <Link to="/settings/dialer" className="underline">Settings</Link> first —
                live dialing arrives once JustCall, Kixie, or Aircall is fully wired up.
              </>
            ) : (
              'Live dialing arrives once a provider is fully wired up — this screen is ready for it.'
            )}
          </p>
        </div>
      </Card>
    </div>
  );
}
