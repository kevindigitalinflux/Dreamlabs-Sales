/** Persisted inside existing icp_params JSON; absent on legacy and Autopilot jobs. */
export interface ScrapeGroup {
  id: string;
  sources: Array<'google_places' | 'companies_house' | 'cro'>;
}

export function readScrapeGroup(params: unknown): ScrapeGroup | null {
  const group = (params as { scrape_group?: Partial<ScrapeGroup> } | null)?.scrape_group;
  if (!group || typeof group.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(group.id)
    || !Array.isArray(group.sources) || !group.sources.length || group.sources.length > 3
    || new Set(group.sources).size !== group.sources.length
    || !group.sources.every((s) => ['google_places', 'companies_house', 'cro'].includes(s))) return null;
  return { id: group.id, sources: group.sources } as ScrapeGroup;
}

/** Grouped registry searches must not add paid Places lookups on top of the main search. */
export function registryContactKey(params: unknown, key: string | null): string | null {
  return readScrapeGroup(params) ? null : key;
}
