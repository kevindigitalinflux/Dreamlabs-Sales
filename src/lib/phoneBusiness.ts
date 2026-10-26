import { parsePhone, type PhoneMetadata } from '../../supabase/functions/_shared/phoneNumbers';

/** Explicit user flag, never inferred from a missing company number. Preserve the number's source evidence. */
export function flagPhoneBusiness(value: string, country: unknown, stored: Record<string, PhoneMetadata> | undefined, soleTrader: boolean): Record<string, PhoneMetadata> {
  const phone = parsePhone(value, country);
  if (!phone) throw new Error('Enter a valid business phone number first.');
  return { ...stored, [phone.value]: { kind: 'unknown', source: 'manual', source_url: null, found_at: null,
    ...stored?.[phone.value], sole_trader: soleTrader } };
}
