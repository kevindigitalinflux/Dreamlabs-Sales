import { Navigate } from 'react-router';

/** /pipeline → the user's last-used view (kanban default), persisted in localStorage. */
export function PipelineRedirect() {
  const view = localStorage.getItem('pipeline-view') === 'list' ? 'list' : 'kanban';
  return <Navigate to={`/pipeline/${view}`} replace />;
}
