import { Link } from 'react-router';
import { STAGES } from '../../lib/utils';
import { STAGE_BADGE_CLASSES, STAGE_ICONS } from '../pipeline/stageStyles';
import type { Lead } from '../../types';

/** Read-only stage counts; each chip deep-links to the filtered list view. */
export function PipelineSnapshot({ leads }: { leads: Lead[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {STAGES.map((s) => {
        const Icon = STAGE_ICONS[s.value];
        const count = leads.filter((l) => l.stage === s.value).length;
        return (
          <Link
            key={s.value}
            to={`/pipeline/list?stage=${s.value}`}
            className={`flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold hover:opacity-80 ${STAGE_BADGE_CLASSES[s.value]}`}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {s.label}
            <span className="rounded-full bg-black/25 px-2">{count}</span>
          </Link>
        );
      })}
    </div>
  );
}
