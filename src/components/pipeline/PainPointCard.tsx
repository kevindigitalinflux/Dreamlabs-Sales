import { useIcps } from '../../hooks/useIcps';
import { usePainPoint } from '../../hooks/usePainPoint';
import { painPointList } from '../../../supabase/functions/_shared/painPointPick';
import { PainPointEditor } from './PainPointEditor';

/** Shared lead-panel and email/Autopilot-review editor, using the existing ICP and note permissions. */
export function PainPointCard({ leadId, icpId, refreshKey, review }: { leadId: string; icpId?: string | null; refreshKey?: unknown; review?: boolean }) {
  const { icps, loading, error } = useIcps();
  const pain = usePainPoint(leadId, refreshKey);
  return <PainPointEditor key={leadId} choice={pain.choice} points={painPointList(icps.find(icp => icp.id === icpId)?.pain_points)}
    loading={loading || pain.loading} error={error ?? pain.error} onSave={pain.save} review={review} />;
}
