import {Bot,Flame,Globe,Landmark,MapPin,Search,Sparkles,Users} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import type {OrgApiSetting} from '../../hooks/useOrgApiSettings';

/** One accent icon per provider, so the list can be scanned without reading every name. */
export const PROVIDER_ICONS: Partial<Record<OrgApiSetting['provider'], LucideIcon>> = {
  gemini: Sparkles, anthropic: Bot, google_places: MapPin, companies_house: Landmark, cro: Landmark,
  opencorporates: Globe, apollo: Users, hunter: Search, firecrawl: Flame,
};

export const PROVIDERS: {
  key: OrgApiSetting['provider'];
  label: string;
  url: string;
  ctaLabel: string;
  freeText: string;
  steps?: string[];
}[] = [
  {
    key: 'firecrawl', label: 'Firecrawl (optional team-page lookup)', url: 'https://www.firecrawl.dev/app/api-keys',
    ctaLabel: 'Get your Firecrawl API key',
    freeText: 'Optional: reads one company team or about page when Deep find cannot find people. Uses your organisation’s own Firecrawl credits, up to 100 page requests a day. Found details are shown for review.',
  },
  {
    key: 'gemini',
    label: 'Gemini (AI drafting)',
    url: 'https://aistudio.google.com/apikey',
    ctaLabel: 'Get your Gemini API key →',
    freeText: "Billing required: the key only works once your Google account has credit, either topped-up prepaid credit or pay-as-you-go. A few pounds goes a long way for drafting. This is a one-time setup for the whole organization, done once by whoever administers it. Usage bills to your own Google account, never Kevin's.",
    steps: [
      'Click the button above and sign in with your Google account.',
      'Click "Create API key" and copy it.',
      'Paste the key into the box below and save.',
      'Now add billing, or every AI feature will say "AI unavailable". Go to https://ai.studio/projects and find the project your key belongs to.',
      'Open that project\'s billing settings and pick ONE option: Prepay (top up credit, for example £5 to start) or Pay as you go (add a card and Google bills your usage).',
      'Wait a few minutes for the billing change to take effect, then try an AI feature. If it still says "AI unavailable", an empty prepaid balance is the most common cause, so check your balance at https://ai.studio/projects and top up.',
    ],
  },
  {
    key: 'google_places',
    label: 'Google Places (lead scraper)',
    url: 'https://console.cloud.google.com/google/maps-apis/credentials',
    ctaLabel: 'Open Google Cloud Console for Places →',
    freeText: "Uses Places API (New), with support for existing legacy-enabled projects. Google gives 1,000 free monthly searches at the tier this app uses, shared across projects on the same billing account. Each search returns up to 20 businesses. The app stops at your monthly limit (900 by default). Google charges apply above its free allowance; other projects using the account count too.",
    steps: [
      'Open Google Cloud Console and pick or create a project.',
      'Enable billing by linking a billing account to that project.',
      'In the API library, search for Places API (New) and click Enable.',
      'Create or reuse an API key. Restrict it to Places API (New). Do not restrict it by website or app: searches run from our server.',
      'Paste the key below. If it is new, wait two minutes and retry if Google has not activated it yet.',
      'For a second limit on your Google account, open Billing → Budgets & alerts. Create a budget with email alerts at 50, 90 and 100 percent. Alerts do not stop charges.',
      'Open APIs & Services → Places API (New) → Quotas. If Text Search requests per day is offered, set a small limit, for example 100. Check the available quota controls in your project.',
    ],
  },
  {
    key: 'cro',
    label: 'CRO (Irish company scraper)',
    url: 'https://services.cro.ie/',
    ctaLabel: 'Open the CRO Open Services site →',
    freeText: "CRO's basic company data is free; check their site for your key's terms. Covers companies registered in Ireland. One-time setup for the whole organization, done once by whoever administers it.",
    steps: [
      'Click the button above and register (or sign in) for a CRO Open Services account.',
      'Request an API key for the CRO web services (CWS). CRO may take a little while to issue it.',
      'Paste it into the box below in the form youremail:key, that is the email you registered with, then a colon, then the key (for example name@company.com:abc123).',
      "CRO's exact login and key format may differ from what we expect. If saving fails, tell us what CRO gave you and we will adjust it.",
    ],
  },
  {
    key: 'companies_house',
    label: 'Companies House (lead scraper)',
    url: 'https://developer.company-information.service.gov.uk/',
    ctaLabel: 'Register for a free Companies House key →',
    freeText: "Free — registration has no cost. One-time setup for the whole organization, done once by whoever administers it.",
    steps: [
      'Click the button above and register (or sign in) for a Companies House developer account.',
      'Click "Add an application" and give it any name you’ll recognize later, e.g. "[Your Company] Dreamlabs Sales".',
      'Inside that application, click "Add API key". For Key type, choose REST (not Streaming or Web).',
      'Leave "Restricted IPs" and "JavaScript domains" blank — this key is used from a server, not a browser, so it has no fixed IP or domain to restrict it to.',
      'Copy the key immediately — it’s only shown once — and paste it into the box below.',
      'If saving says the key was rejected right after creating it, wait a few minutes and try again — brand-new Companies House keys can take a little while to activate.',
    ],
  },
  {
    key: 'opencorporates',
    label: 'OpenCorporates (owner lookup outside the UK)',
    url: 'https://opencorporates.com/api_accounts/new',
    ctaLabel: 'Get your free OpenCorporates API key →',
    freeText: "Free tier — capped at 200 requests/month and 50/day, registration required. Optional: Companies House alone already covers UK companies for the bulk enrichment feature; this extends owner-name lookup to other countries on a best-effort basis (coverage varies a lot by jurisdiction).",
  },
  {
    key: 'apollo',
    label: 'Apollo.io (optional lead enrichment)',
    url: 'https://app.apollo.io/#/settings/integrations/api',
    ctaLabel: 'Get your Apollo API key →',
    freeText: "A free Apollo account can create an API key (confirmed 2026-09-23) — usage is limited by whatever credits your Apollo plan includes. Usage bills to your own Apollo account, never Kevin's. Entirely optional: only appears as an \"Enrich with Apollo\" button on individual leads if configured — nothing runs automatically.",
    steps: [
      'Click the button above to open Apollo (sign in or create a free account first if you don’t have one).',
      'Click "API Keys" inside Apollo’s settings.',
      'Click "Create new key" and give it a name you’ll recognize, e.g. "Dreamlabs Sales".',
      'Copy the generated key immediately and save it somewhere secure — it’s only shown once.',
      'Paste it into the box below.',
    ],
  },
  {
    key: 'hunter',
    label: 'Hunter.io (optional email finder)',
    url: 'https://hunter.io/api-keys',
    ctaLabel: 'Get your Hunter API key →',
    freeText: "Hunter's free plan includes some monthly credits but API access requires a paid plan. Usage bills to your own Hunter account, never Kevin's. Entirely optional: only appears as a \"Find email with Hunter\" button on individual leads if configured.",
    steps: [
      'Click the button above and sign in (or create a Hunter.io account).',
      'You’ll land on the API page — Hunter shows your account’s API key there directly (generate one if the page prompts you to).',
      'Copy the key and paste it into the box below.',
    ],
  },
  {
    key: 'anthropic',
    label: 'Anthropic Claude (outreach AI)',
    url: 'https://console.anthropic.com/settings/keys',
    ctaLabel: 'Get your Anthropic API key →',
    freeText: "Powers cold-email/JV-pitch/LinkedIn drafting for this org. Trivially cheap at real volume (a few dollars a month even sending hundreds of messages). Mr Brush & Co and DI Dreamlabs fall back to Kevin's key automatically if this isn't configured, matching how Gemini already works — other orgs need their own key before outreach automation activates.",
  },
];
