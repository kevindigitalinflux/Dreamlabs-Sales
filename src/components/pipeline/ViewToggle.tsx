import { useNavigate } from 'react-router';
import { KanbanSquare, List } from 'lucide-react';

/** Kanban/List segmented toggle; remembers the choice in localStorage. */
export function ViewToggle({ current }: { current: 'kanban' | 'list' }) {
  const navigate = useNavigate();

  function go(view: 'kanban' | 'list') {
    localStorage.setItem('pipeline-view', view);
    navigate(`/pipeline/${view}`);
  }

  const base = 'flex min-h-11 cursor-pointer items-center gap-2 px-4 text-sm font-semibold transition-colors motion-reduce:transition-none';
  return (
    <div className="flex overflow-hidden rounded-lg border border-line" role="group" aria-label="Pipeline view">
      <button type="button" onClick={() => go('kanban')} aria-pressed={current === 'kanban'} className={`${base} ${current === 'kanban' ? 'bg-violet/25 text-offwhite' : 'text-muted hover:text-offwhite'}`}>
        <KanbanSquare className="h-4 w-4" aria-hidden />
        Kanban
      </button>
      <button type="button" onClick={() => go('list')} aria-pressed={current === 'list'} className={`${base} ${current === 'list' ? 'bg-violet/25 text-offwhite' : 'text-muted hover:text-offwhite'}`}>
        <List className="h-4 w-4" aria-hidden />
        List
      </button>
    </div>
  );
}
