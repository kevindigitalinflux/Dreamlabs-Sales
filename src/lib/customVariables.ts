// Mirrors supabase/functions/_shared/customVariables.ts (merge rule + reserved keys): keep in sync.

/**
 * Built-in placeholders whose value comes from the lead or the sender; a custom one can't
 * reuse these names. (cal_link and audit_date are not listed: nothing fills them yet, so a
 * user may define them.)
 */
export const RESERVED_VARIABLE_KEYS = [
  'first_name', 'business_name', 'owner_name', 'package_name', 'deal_value',
  'contractor_name', 'pain_point', 'unsubscribe_url',
];

const MAX_KEY_LENGTH = 40;

/**
 * Turns whatever was typed (a label like "Google Meet link", or a half-typed name) into a
 * valid placeholder name: lowercase letters, digits and underscores, starting with a letter.
 */
export function slugifyVariableKey(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9_]+/, '')
    .slice(0, MAX_KEY_LENGTH)
    .replace(/_+$/g, '');
  return slug;
}

/** Why a placeholder name can't be used, or null if it can. `existingKeys` are the ones already taken in the same scope. */
export function validateVariableKey(key: string, existingKeys: string[] = []): string | null {
  if (!key) return 'Give the placeholder a name.';
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) return 'Use lowercase letters, numbers and underscores, starting with a letter.';
  if (RESERVED_VARIABLE_KEYS.includes(key)) return `{{${key}}} is already built in. Pick a different name.`;
  if (existingKeys.includes(key)) return `You already have a {{${key}}} placeholder.`;
  return null;
}

/** Fills missing/blank placeholders from custom values; a built-in that already has a value always wins. */
export function applyCustomVariables(
  vars: Record<string, string | null>,
  custom: Record<string, string>,
): Record<string, string | null> {
  const out = { ...vars };
  for (const [key, value] of Object.entries(custom)) {
    if (RESERVED_VARIABLE_KEYS.includes(key)) continue;
    if (out[key] === null || out[key] === undefined || out[key] === '') out[key] = value;
  }
  return out;
}
