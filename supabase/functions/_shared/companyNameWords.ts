/**
 * Industry and trade words. They may be part of a company's name (and of its domain), but they never identify WHICH
 * company it is: "Sparkle Cleaning" is identified by "sparkle", not "cleaning". Strict matches require the
 * distinctive words (brand words minus these).
 */
export const INDUSTRY_WORDS = new Set([
  'cleaning', 'cleaners', 'cleaner', 'clean', 'property', 'properties', 'homes', 'home', 'housing', 'lettings',
  'letting', 'lets', 'estates', 'estate', 'agents', 'agent', 'agency', 'rentals', 'rental', 'design', 'designs',
  'web', 'digital', 'media', 'marketing', 'consulting', 'consultancy', 'consultants', 'builders', 'building', 'construction',
  'plumbing', 'plumbers', 'electrical', 'electricians', 'roofing', 'care', 'health', 'healthcare', 'dental', 'clinic',
  'legal', 'law', 'solicitors', 'accountants', 'accounting', 'finance', 'financial', 'insurance', 'travel', 'cars',
  'motors', 'garage', 'salon', 'beauty', 'hair', 'cafe', 'restaurant', 'studio', 'studios', 'facilities', 'maintenance',
  'office', 'offices', 'commercial', 'residential', 'domestic', 'logistics', 'transport', 'recruitment', 'staffing',
  'events', 'catering', 'training', 'education', 'school', 'nursery', 'fitness', 'gym', 'tech', 'technology', 'systems',
  'software', 'it', 'network', 'networks', 'print', 'printing', 'supplies', 'supply', 'hire', 'repairs', 'repair',
]);

/**
 * Words that say nothing about which company it is. A name made only of these has no brand words, and no domain is
 * ever matched to it. Ordinary nouns that are often the brand itself (living, homes, cleaning) are deliberately kept.
 */
export const GENERIC_COMPANY_WORDS = new Set([
  'ltd', 'limited', 'plc', 'llp', 'lp', 'inc', 'corp', 'corporation', 'co', 'company', 'companies', 'the', 'and', 'of',
  'group', 'holdings', 'holding', 'management', 'services', 'service', 'solutions', 'international', 'global',
  'enterprises', 'enterprise', 'trading', 'partners', 'partnership', 'associates', 'london', 'uk', 'gb', 'england',
  'britain', 'british', 'scotland', 'wales', 'ireland', 'ie', 'europe', 'cic',
]);

