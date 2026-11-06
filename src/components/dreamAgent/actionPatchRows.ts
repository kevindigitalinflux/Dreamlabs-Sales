import {formatCurrency,packageLabel,stageInfo} from '../../lib/utils';
import {splitContactPatch} from '../../lib/dreamAgentActions';
import type {DreamAgentUpdatePatch,Lead} from '../../types';
const CONTACT_LABELS = { owner_name: 'Owner', phone: 'Phone', email: 'Email', website: 'Website', address: 'Address', city: 'City', postcode: 'Postcode', vertical: 'Business type' };
const ADDITIONAL_LABELS = { owner_name: 'owner', phone: 'phone', email: 'email', website: 'website' };

/** From→to rows for a patch. `lead` is undefined for a lead that doesn't exist yet (a `create`), so every "from" is an em dash. */
export function patchRows(patch: DreamAgentUpdatePatch, lead: Lead | undefined, includeContact = false, icpNames: Record<string, string> = {}): { label: string; from: string; to: string }[] {
  const rows: { label: string; from: string; to: string }[] = [];
  if (patch.icp_id && patch.icp_id !== lead?.icp_id) rows.push({ label: 'Customer profile', from: (lead?.icp_id && icpNames[lead.icp_id]) || '—', to: icpNames[patch.icp_id] ?? patch.icp_id });
  if (includeContact) {
    // Existing leads: blanks are filled, differing email/phone/website/owner are kept as additional.
    const { fill, additions } = splitContactPatch(lead, patch);
    for (const [key, value] of Object.entries(fill)) rows.push({ label: CONTACT_LABELS[key as keyof typeof CONTACT_LABELS], from: '—', to: value });
    for (const a of additions) rows.push({ label: `Additional ${ADDITIONAL_LABELS[a.field]}`, from: '—', to: a.value });
  }
  const currentStage = lead?.stage ?? 'new_lead';
  if (patch.stage && patch.stage !== currentStage) rows.push({ label: 'Stage', from: stageInfo(currentStage).label, to: stageInfo(patch.stage).label });
  if (patch.deal_value !== undefined) rows.push({ label: 'Deal value', from: lead?.deal_value != null ? formatCurrency(lead.deal_value) : '—', to: formatCurrency(patch.deal_value) });
  if (patch.package_tier) rows.push({ label: 'Package', from: packageLabel(lead?.package_tier ?? null), to: packageLabel(patch.package_tier) });
  if (patch.next_action_date) rows.push({ label: 'Next action date', from: lead?.next_action_date ?? '—', to: patch.next_action_date });
  if (patch.next_action_note) rows.push({ label: 'Next action', from: lead?.next_action_note ?? '—', to: patch.next_action_note });
  if (patch.pain_point) rows.push({ label: 'Pain point (info only)', from: '—', to: patch.pain_point });
  return rows;
}

