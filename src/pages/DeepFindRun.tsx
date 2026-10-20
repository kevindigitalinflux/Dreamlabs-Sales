import { Link, useParams } from 'react-router';
import { DeepFindProgress } from '../components/deepfind/DeepFindProgress';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /pipeline/deep-find/:runId: one Deep find run's live results (company choices, domains, people, Cancel). */
export function DeepFindRun() {
  const { runId } = useParams();
  const valid = typeof runId === 'string' && UUID_RE.test(runId);
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-extrabold">Deep find</h1>
        <Link to="/pipeline/deep-find" className="text-sm underline hover:text-offwhite">All Deep find runs</Link>
      </div>
      {valid ? <DeepFindProgress runId={runId} /> : <p role="alert" className="text-sm text-danger">This Deep find could not be found.</p>}
    </div>
  );
}
