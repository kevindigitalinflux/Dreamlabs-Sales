import {useEffect,useRef} from 'react';
import {DismissedRow} from './DismissedRow';
import {dismissedTitle,isDismissed} from '../../lib/dreamAgentDismissed';
import {ActionCard} from './ActionCard';
import type {ActionRowProps} from './ActionRowTypes';
/** Renders the full card, or a compact "Dismissed" row with Undo once dismissed.
 * The card stays mounted (hidden) so edits survive an Undo. */
export function ActionRow(props: ActionRowProps) {
  const { action, resolution, leadsById, contactsByLead = {}, onResolve } = props;
  const dismissed = isDismissed(resolution);
  const cardRef = useRef<HTMLDivElement>(null);
  const wasDismissed = useRef(false);
  useEffect(() => {
    if (wasDismissed.current && !dismissed) cardRef.current?.querySelector<HTMLElement>('button, input, select, textarea')?.focus();
    wasDismissed.current = dismissed;
  }, [dismissed]);
  let contactName: string | undefined;
  if (action.type === 'update_contact') {
    const c = (contactsByLead[action.lead_id] ?? []).find((x) => x.id === action.contact_id);
    contactName = (c && ([c.first_name, c.last_name].filter(Boolean).join(' ') || c.label)) || undefined;
  }
  const title = dismissedTitle(action, { leadName: 'lead_id' in action ? leadsById[action.lead_id]?.business_name : undefined, contactName });
  return (
    <>
      {dismissed && <DismissedRow title={title} onUndo={() => onResolve({ status: 'pending' })} />}
      <div ref={cardRef} hidden={dismissed}><ActionCard {...props} /></div>
    </>
  );
}
