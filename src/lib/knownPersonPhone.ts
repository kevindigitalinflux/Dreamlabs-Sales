import { contactToForm } from './leadContacts';
import type { ContactFormValues } from './leadContacts';
import { decidePhoneSave } from './knownPersonForm';
import type { DecisionMakerCandidate } from '../types';

/**
 * After a known-person lookup saved the person, saves the phone the user typed (the
 * lookup request cannot carry one) through the normal contact edit. Never fails the add:
 * every problem comes back as a plain-English note. A phone a provider already filled is kept.
 */
export async function savePhoneAfterLookup(
  typedPhone: string,
  contactId: string,
  rows: DecisionMakerCandidate[] | null,
  update: (row: DecisionMakerCandidate, form: ContactFormValues) => Promise<{ error: string | null }>,
): Promise<string[]> {
  if (!typedPhone.trim()) return [];
  const row = rows?.find((r) => r.id === contactId) ?? null;
  if (!row) return ['Saved, but the phone number could not be saved: the new contact could not be found. Add the number by editing the person.'];
  const decision = decidePhoneSave(typedPhone, row.phone);
  if (decision.action === 'skip') return [];
  if (decision.action === 'note') return [decision.note];
  const result = await update(row, { ...contactToForm(row), phone: decision.phone });
  return result.error ? [`Saved, but the phone number could not be saved: ${result.error}`] : [];
}
