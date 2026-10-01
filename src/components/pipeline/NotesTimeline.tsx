import { Mail, PhoneCall, Sparkles, StickyNote, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { LeadNote, NoteType } from '../../types';
import { formatShortDate } from '../../lib/utils';
import { Skeleton } from '../ui/Skeleton';
import { EditableNote } from './EditableNote';

/** Icon per note type — notes are icon + label, never colour-coded alone. */
export const NOTE_TYPE_ICONS: Record<NoteType, LucideIcon> = {
  call: PhoneCall,
  email: Mail,
  meeting: Users,
  general: StickyNote,
  ai_summary: Sparkles,
};

interface NotesTimelineProps {
  notes: LeadNote[];
  loading: boolean;
  authorName: (id: string | null) => string;
  /** When given, each note (except system stage-change entries) can be edited in place. */
  onEditNote?: (noteId: string, content: string) => Promise<string | null>;
}

/** All notes for a lead, newest first, with author + timestamp + type icon. */
export function NotesTimeline({ notes, loading, authorName, onEditNote }: NotesTimelineProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (notes.length === 0) return <p className="text-sm text-muted">No notes yet — log your first call below.</p>;
  return (
    <ol className="flex flex-col gap-3">
      {notes.map((note) => {
        const Icon = NOTE_TYPE_ICONS[note.note_type];
        return (
          <li key={note.id} className="flex gap-3 rounded-lg bg-surface/50 p-3">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-label={note.note_type} />
            <div className="min-w-0 flex-1">
              {onEditNote
                ? <EditableNote note={note} onSave={onEditNote} />
                : <p className="whitespace-pre-wrap text-sm">{note.content}</p>}
              <p className="mt-1 text-xs text-muted">
                {authorName(note.created_by)} · {formatShortDate(note.created_at)} · {note.note_type.replace('_', ' ')}{note.edited_at ? ' · edited' : ''}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
