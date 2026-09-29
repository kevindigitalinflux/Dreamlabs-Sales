import { useMemo } from 'react';
import { PACKAGE_TIERS } from '../lib/utils';
import type { PackageTier } from '../types';
import { useOrg } from './useOrg';

export interface PackageOption { value: PackageTier; label: string }

/**
 * The package options offered for the current org: its own custom list when an
 * admin has set one (stored value === name), otherwise the built-in DI
 * Dreamlabs list. `optionsFor(current)` also keeps a lead's existing value
 * selectable when it's no longer in the list (e.g. after the org renamed or
 * removed a package), so opening the dropdown never silently drops it.
 */
export function useOrgPackages() {
  const { currentOrg } = useOrg();
  const custom = currentOrg?.custom_packages ?? null;

  return useMemo(() => {
    const options: PackageOption[] = custom && custom.length > 0
      ? custom.map((name) => ({ value: name, label: name }))
      : PACKAGE_TIERS;
    const allowed = new Set(options.map((o) => o.value));
    const optionsFor = (current: PackageTier | null): PackageOption[] => (
      current && !allowed.has(current)
        ? [...options, { value: current, label: PACKAGE_TIERS.find((t) => t.value === current)?.label ?? current }]
        : options
    );
    return { options, allowed, optionsFor, isCustom: options !== PACKAGE_TIERS };
  }, [custom]);
}
