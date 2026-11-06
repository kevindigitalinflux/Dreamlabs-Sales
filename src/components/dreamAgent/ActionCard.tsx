import {ContactActionRow} from './ContactActionRow';
import {ActionContextCard} from './ActionContextCard';
import {ActionLeadCard} from './ActionLeadCard';
import {ActionAmbiguousCard} from './ActionAmbiguousCard';
import type {ActionRowProps} from './ActionRowTypes';
/** One proposed action from Dream Agent, resolved by the user before it can be
 * confirmed. `update` renders a from/to diff (matching SuggestionDiff's pattern);
 * `create` shows extracted fields + a pipeline picker if needed; `ambiguous` shows
 * a candidate picker plus "this is someone new", which itself becomes a create-like
 * picker step rather than guessing a pipeline; `update_company_context` shows an
 * editable textarea pre-filled with the AI's proposed merge. */
export function ActionCard(props:ActionRowProps) {
 const {action,resolution,leadsById,contactsByLead={},messages=[],onResolve,onBulkReady}=props;
 if(action.type==='add_contact'||action.type==='update_contact'){
 const existing=action.type==='update_contact'?(contactsByLead[action.lead_id]??[]).find(c=>c.id===action.contact_id):undefined;
 return <ContactActionRow key={existing?.id??'new'} action={action} resolution={resolution} existing={existing} leadContacts={contactsByLead[action.lead_id]??[]} contactsLoaded={contactsByLead[action.lead_id]!==undefined} messages={messages} leadName={leadsById[action.lead_id]?.business_name??'this lead'} onResolve={onResolve} onBulkReady={onBulkReady} />;
 }
 if(action.type==='update_company_context')return <ActionContextCard {...props} />;
 if(action.type==='update'||action.type==='create')return <ActionLeadCard {...props} />;
 return <ActionAmbiguousCard {...props} />;
}
