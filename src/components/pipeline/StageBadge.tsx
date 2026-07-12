import { Badge } from '../ui/Badge';
import { stageInfo } from '../../lib/utils';
import { STAGE_BADGE_CLASSES, STAGE_ICONS } from './stageStyles';
import type { Stage } from '../../types';

/** Stage pill: icon + colour + label (ADHD rule: never colour-only). */
export function StageBadge({ stage }: { stage: Stage }) {
  const Icon = STAGE_ICONS[stage];
  return (
    <Badge className={STAGE_BADGE_CLASSES[stage]}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {stageInfo(stage).label}
    </Badge>
  );
}
