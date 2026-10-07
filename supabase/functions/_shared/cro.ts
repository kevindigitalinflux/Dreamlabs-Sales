// supabase/functions/_shared/cro.ts
// CONFIRM against a live response once the CRO key exists.
// Everything below is a best guess (no CRO key at build time): the endpoint,
// the Basic auth scheme (email:apiKey) and the response field names. If a live
// call differs, fix ONLY this block and parseCroCompanies' field reads.
const CRO_BASE_URL = 'https://services.cro.ie/cws/companies';
const CRO_COMPANY_TYPE = 'C'; // company_bus_ind=C (companies, not business names)
const CRO_ADDRESS_FIELDS = ['company_address_1', 'company_address_2', 'company_address_3', 'company_address_4'] as const;

export interface CroCompany {
  company_number: string; name: string; address: string | null; status: string | null; eircode: string | null;
}

function text(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  return null;
}

/** Tolerant mapper for CRO search rows: rows without a name are dropped, anything that is not an array gives []. */
export function parseCroCompanies(payload: unknown): CroCompany[] {
  if (!Array.isArray(payload)) return [];
  const out: CroCompany[] = [];
  for (const row of payload) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const name = text(r.company_name);
    if (!name) continue;
    const address = CRO_ADDRESS_FIELDS.map((f) => text(r[f])).filter((s): s is string => !!s).join(', ');
    out.push({
      company_number: text(r.company_num) ?? '',
      name,
      address: address || null,
      status: text(r.company_status_desc),
      eircode: text(r.eircode),
    });
  }
  return out;
}

/** Searches CRO Open Services by company name. Throws "CRO HTTP n" on a non-2xx response. */
export async function searchCroCompanies(
  query: string, cap: number, creds: { email: string; apiKey: string },
): Promise<CroCompany[]> {
  const url = `${CRO_BASE_URL}?company_name=${encodeURIComponent(query)}&company_bus_ind=${CRO_COMPANY_TYPE}&skip=0&max=${cap}&htmlEnc=1`;
  // Inline timeout instead of importing fetchWithTimeout.ts: a `.ts` import path breaks the root tsc
  // check because the unit test imports this file (the test tsconfig does not allow .ts extensions).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let data: unknown;
  try {
    const res = await fetch(url, {
      headers: { Authorization: 'Basic ' + btoa(`${creds.email}:${creds.apiKey}`), Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`CRO HTTP ${res.status}`);
    data = await res.json() as unknown;
  } finally {
    clearTimeout(timer);
  }
  // Some responses may wrap rows in an object; accept a bare array or { items | companies }.
  const rows = Array.isArray(data) ? data
    : data && typeof data === 'object' ? ((data as Record<string, unknown>).items ?? (data as Record<string, unknown>).companies) : null;
  return parseCroCompanies(rows).slice(0, cap);
}

/** Splits the stored "email:apiKey" secret on the first colon. Returns null when there is no colon or either half is empty. */
export function splitCroSecret(secret: string): { email: string; apiKey: string } | null {
  const i = secret.indexOf(':');
  if (i <= 0 || i === secret.length - 1) return null;
  return { email: secret.slice(0, i).trim(), apiKey: secret.slice(i + 1).trim() };
}

/** Maps a "CRO HTTP n" error from searchCroCompanies to "CRO rejected the key (HTTP n)". Returns null for any other error. */
export function croRejectionMessage(err: unknown): string | null {
  const m = err instanceof Error ? /^CRO HTTP (\d+)$/.exec(err.message) : null;
  return m ? `CRO rejected the key (HTTP ${m[1]})` : null;
}
