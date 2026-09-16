import { isFuzzyNameMatch } from './fuzzyMatch.ts';

interface OpenCorporatesCompany { name?: string; jurisdiction_code?: string; company_number?: string }
interface OpenCorporatesOfficer { name?: string }

/**
 * Free-tier (200/month, 50/day on the default plan), non-UK-focused
 * best-effort owner-name lookup — the OpenCorporates counterpart to
 * lookupCompaniesHouseOfficer for jurisdictions outside the UK. Coverage
 * varies by country depending on what that jurisdiction's registry has fed
 * into OpenCorporates; a null return is an expected, non-error outcome, not
 * a failure.
 */
export async function lookupOpenCorporatesOfficer(businessName: string, apiKey: string): Promise<string | null> {
  try {
    const searchRes = await fetch(`https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(businessName)}&api_token=${apiKey}`);
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json() as { results?: { companies?: { company: OpenCorporatesCompany }[] } };
    const top = searchData.results?.companies?.[0]?.company;
    if (!top?.name || !top.jurisdiction_code || !top.company_number) return null;
    if (!isFuzzyNameMatch(businessName, top.name)) return null;

    const detailRes = await fetch(`https://api.opencorporates.com/v0.4/companies/${top.jurisdiction_code}/${top.company_number}?api_token=${apiKey}`);
    if (!detailRes.ok) return null;
    const detailData = await detailRes.json() as { results?: { company?: { officers?: { officer: OpenCorporatesOfficer }[] } } };
    const officer = detailData.results?.company?.officers?.[0]?.officer;
    return officer?.name ?? null;
  } catch {
    return null;
  }
}
