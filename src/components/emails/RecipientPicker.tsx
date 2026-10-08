import type { Recipient } from '../../lib/composerRecipients';

interface RecipientPickerProps {
  recipients: Recipient[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  /** Show the "each person gets their own email" hint. */
  multi: boolean;
}

/** Small tag shown on a shared inbox, so it is not mistaken for a named person. */
export function GeneralInboxTag() {
  return <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-muted">General inbox</span>;
}

/** The "Send to" checkboxes: the lead's own email, legacy extra addresses and contacts (people and general inboxes). */
export function RecipientPicker({ recipients, selected, onToggle, multi }: RecipientPickerProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold text-muted">Send to</p>
      {recipients.map((r) => (
        <label key={r.key} className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 text-sm">
          <input type="checkbox" checked={selected.has(r.key)} onChange={() => onToggle(r.key)} className="h-4 w-4 accent-violet-500" />
          {r.label}
          {r.kind === 'general' && <GeneralInboxTag />}
        </label>
      ))}
      {multi && (
        <p className="text-xs text-muted">Each person you tick gets their own email, written for them. You can edit each one below.</p>
      )}
    </div>
  );
}
