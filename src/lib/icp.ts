import type { IdealCustomerProfile } from '../types';

/**
 * Text to pre-fill a lead search with when a customer profile is picked: the profile's name
 * and its "who they are" description, which the search's own AI step then turns into
 * location/industry/size filters. Falls back to just the name when there is no summary.
 */
export function searchTextFromIcp(profile: Pick<IdealCustomerProfile, 'name' | 'summary'>): string {
  const summary = (profile.summary ?? '').replace(/\s+/g, ' ').trim();
  return summary ? `${profile.name}: ${summary}` : profile.name;
}
