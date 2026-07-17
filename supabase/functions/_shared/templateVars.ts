// Deno copy of src/lib/templateVars.ts — keep the two in sync.

/** Whole-pound GBP: 1200 → "£1,200". */
function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n);
}

type PackageTier =
  | 'pilot_systems' | 'pilot_ai_app' | 'pilot_full_build'
  | 'automation_sprint' | 'ai_foundation' | 'full_build'
  | 'retainer_bronze' | 'retainer_silver' | 'retainer_gold' | 'custom';

/** All package tiers with display labels (SPEC.md §3 leads.package_tier). */
const PACKAGE_TIERS: { value: PackageTier; label: string }[] = [
  { value: 'pilot_systems', label: 'Pilot — Systems' },
  { value: 'pilot_ai_app', label: 'Pilot — AI App' },
  { value: 'pilot_full_build', label: 'Pilot — Full Build' },
  { value: 'automation_sprint', label: 'Automation Sprint' },
  { value: 'ai_foundation', label: 'AI Foundation' },
  { value: 'full_build', label: 'Full Build' },
  { value: 'retainer_bronze', label: 'Retainer — Bronze' },
  { value: 'retainer_silver', label: 'Retainer — Silver' },
  { value: 'retainer_gold', label: 'Retainer — Gold' },
  { value: 'custom', label: 'Custom' },
];

/** Display label for a package tier; em dash for none. */
function packageLabel(tier: PackageTier | null): string {
  if (!tier) return '—';
  return PACKAGE_TIERS.find((t) => t.value === tier)?.label ?? tier;
}

/** Replaces {{key}} with values; empty/unknown keys blank out and are reported in `missing`. */
export function substituteVariables(
  text: string,
  vars: Record<string, string | null | undefined>,
): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const out = text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = vars[key];
    if (value === null || value === undefined || value === '') {
      missing.add(key);
      return '';
    }
    return value;
  });
  return { text: out, missing: [...missing] };
}

/** Builds the variable map for a lead. `notes` = latest note contents, newest first. */
export function buildTemplateVars(
  lead: Record<string, unknown>,
  contractorName: string,
  notes: string[] = [],
): Record<string, string | null> {
  const ownerName = lead.owner_name as string | null;
  const businessName = lead.business_name as string;
  const packageTier = lead.package_tier as PackageTier | null;
  const dealValue = lead.deal_value as number | null;
  const painPoint = notes
    .map((n) => /Main pain point:\n([^\n]+)/.exec(n)?.[1]?.trim() ?? null)
    .find((p) => p) ?? null;
  return {
    first_name: ownerName?.split(' ')[0] ?? null,
    business_name: businessName,
    owner_name: ownerName,
    audit_date: null,
    package_name: packageTier ? packageLabel(packageTier) : null,
    deal_value: dealValue !== null ? formatCurrency(dealValue) : null,
    contractor_name: contractorName,
    pain_point: painPoint,
    cal_link: null,
  };
}
