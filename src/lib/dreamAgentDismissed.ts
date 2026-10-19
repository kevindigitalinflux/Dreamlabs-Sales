import type { ActionResolution } from '../hooks/useDreamAgentSession';
import type { DreamAgentAction } from '../types';

export function isDismissed(resolution: ActionResolution): boolean {
  return resolution.status === 'dismissed';
}

/** Short title for a row that has been dismissed (shown greyed with a "Dismissed" label). */
export function dismissedTitle(action: DreamAgentAction, ctx: { leadName?: string; contactName?: string }): string {
  switch (action.type) {
    case 'create': return `New lead: ${action.extracted.business_name}`;
    case 'update': return `Update: ${action.business_name}`;
    case 'ambiguous': return `Unclear mention: ${action.mentioned_text}`;
    case 'update_company_context': return 'Company context update';
    case 'add_contact':
    case 'update_contact': {
      const name = action.type === 'add_contact'
        ? [action.first_name, action.last_name].filter(Boolean).join(' ') || action.label || ''
        : ctx.contactName ?? '';
      const verb = action.type === 'add_contact' ? 'Add contact' : 'Update contact';
      return `${verb}${name ? `: ${name}` : ''} on ${ctx.leadName ?? 'this lead'}`;
    }
  }
}
