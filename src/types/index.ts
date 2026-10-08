import type { EmailAttachment, EmailLink } from '../lib/emailAttachments';

export type Role = 'admin' | 'contractor' | 'team_member';

export type PlatformRole = 'platform_admin' | 'user';

export interface OrgMembership {
  id: string;
  name: string;
  role: Role;
  /** Org-specific package names; null = use the built-in default list. */
  custom_packages: string[] | null;
}

export type Stage =
  | 'new_lead' | 'contacted' | 'audit_booked' | 'proposal_sent'
  | 'negotiating' | 'won' | 'lost' | 'not_now_nurture';

/**
 * A package's stored value. For the built-in DI Dreamlabs list this is one of
 * the slugs in PACKAGE_TIERS (utils.ts); for an org's own custom list
 * (organizations.custom_packages) it is the package name itself.
 */
export type PackageTier = string;

export type NoteType = 'call' | 'email' | 'meeting' | 'general' | 'ai_summary';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  platform_role: PlatformRole;
  avatar_url: string | null;
  theme_preference: 'light' | 'dark';
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  business_name: string;
  owner_name: string | null;
  phone: string | null;
  email: string | null;
  /** True once the lead has unsubscribed (migration 010). */
  opted_out?: boolean;
  website: string | null;
  /** The ideal customer profile this lead is most like; overrides its template's/sequence's profile when drafting. */
  icp_id: string | null;
  /** Extra values kept alongside the primary email/phone/website/owner (e.g. from Fill missing details). */
  additional_emails: string[];
  additional_phones: string[];
  additional_websites: string[];
  additional_owners: string[];
  address: string | null;
  city: string | null;
  postcode: string | null;
  google_rating: number | null;
  review_count: number | null;
  vertical: string | null;
  stage: Stage;
  package_tier: PackageTier | null;
  deal_value: number | null;
  assigned_to: string | null;
  created_by: string | null;
  raw_lead_id: string | null;
  pipeline_id: string;
  forked_from_lead_id: string | null;
  next_action_date: string | null;
  next_action_note: string | null;
  is_priority: boolean;
  call_count: number;
  last_contacted_at: string | null;
  kanban_position: number;
  created_at: string;
  updated_at: string;
}

// Kept in sync with supabase/functions/enrich-leads-bulk/index.ts's own
// Deno-side copy (Field/EnrichResult) — see that file's comment.
export type EnrichableField = 'email' | 'phone' | 'owner_name' | 'website';

export interface EnrichmentResult {
  lead_id: string;
  proposed: Partial<Record<EnrichableField, string>>;
  source: Partial<Record<EnrichableField, string>>;
}

export interface DecisionMakerCandidate {
  id: string;
  lead_id: string;
  source: 'hunter' | 'apollo' | 'companies_house' | 'cro' | 'manual' | 'dream_agent';
  /** 'person' (a named individual) or 'general' (a shared inbox such as reception). */
  kind: 'person' | 'general';
  /** Free-text name for a general contact, e.g. 'General reception'. */
  label: string | null;
  /** The contact emailed by default; at most one live primary per lead. */
  is_primary: boolean;
  /** Whether sequence follow-ups are drafted for this contact. */
  include_in_sequences: boolean;
  apollo_person_id: string | null;
  first_name: string | null;
  last_name: string | null;
  name_obfuscated: boolean;
  title: string | null;
  email: string | null;
  email_revealed: boolean;
  phone: string | null;
  phone_status: 'not_requested' | 'pending' | 'revealed' | 'not_found' | 'failed';
  linkedin_url: string | null;
  /** Set when the user removed this person as not relevant; hidden everywhere and kept so a re-search doesn't re-add them. */
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Pipeline {
  id: string;
  org_id: string;
  name: string;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
}

export type PipelinePermission = 'view' | 'edit';

export interface PipelineShare {
  id: string;
  pipeline_id: string;
  shared_with_user_id: string;
  permission: PipelinePermission;
  shared_by: string | null;
  created_at: string;
}

export interface LeadNote {
  id: string;
  lead_id: string;
  created_by: string | null;
  content: string;
  note_type: NoteType;
  ai_extracted_data: unknown;
  created_at: string;
  /** Set when the note's text was changed after it was written. */
  edited_at: string | null;
}

export type TemplateType =
  | 'initial_followup' | 'second_chase' | 'not_now_nurture'
  | 'audit_confirmation' | 'proposal_followup' | 'custom';

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  template_type: TemplateType;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
  /** Files (PDF/PNG/JPEG) attached to every email made from this template. */
  attachments: EmailAttachment[];
  /** Links (videos included) appended to the end of the email body. */
  links: EmailLink[];
  /** Free-text grouping (e.g. 'Property managers'); null = uncategorised. */
  category: string | null;
  /** The ideal customer profile this template is written for (see lib/icp). */
  icp_id: string | null;
}

export interface SequenceStep {
  delay_days: number;
  template_type: TemplateType;
  /** Set when the step uses one of the user's own (custom) templates; see lib/sequenceSteps.ts. */
  template_id?: string | null;
  subject_override: string | null;
}

export interface EmailSequence {
  id: string;
  name: string;
  description: string | null;
  steps: SequenceStep[];
  is_default: boolean;
  /** Free-text grouping (e.g. 'Property managers'); null = uncategorised. */
  category: string | null;
  /** Default customer profile for steps whose template has none of its own. */
  icp_id: string | null;
  auto_draft_on_reply: boolean;
  created_by: string | null;
  created_at: string;
}

export type EnrollmentStatus = 'active' | 'paused' | 'completed' | 'cancelled';

export interface SequenceEnrollment {
  id: string;
  lead_id: string;
  sequence_id: string;
  current_step: number;
  next_send_at: string | null;
  status: EnrollmentStatus;
  enrolled_by: string | null;
  created_at: string;
}

export type EmailLogStatus = 'draft' | 'sent' | 'failed';

export interface EmailLog {
  id: string;
  lead_id: string | null;
  sequence_enrollment_id: string | null;
  sent_by: string | null;
  to_email: string;
  subject: string;
  body: string;
  status: EmailLogStatus;
  error_message: string | null;
  message_id: string | null;
  sent_at: string;
  decision_maker_candidate_id: string | null;
  /** Files this draft carries / this sent email carried. */
  attachments: EmailAttachment[];
}

export type EmailProvider = 'gmail' | 'outlook' | 'yahoo' | 'smtp';

export interface UserEmailSettings {
  id: string;
  user_id: string;
  provider: EmailProvider;
  smtp_host: string | null;
  smtp_port: number;
  smtp_user: string | null;
  from_name: string | null;
  is_verified: boolean;
  imap_host: string | null;
  imap_port: number | null;
  last_imap_check_at: string | null;
  created_at: string;
  updated_at: string;
}

export type DialerProvider = 'justcall' | 'kixie' | 'aircall';

export interface UserDialerSettings {
  id: string;
  user_id: string;
  provider: DialerProvider;
  phone_number: string | null;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

export type CallOutcome = 'answered' | 'voicemail' | 'no_answer' | 'busy' | 'failed';

export interface Call {
  id: string;
  lead_id: string | null;
  user_id: string | null;
  org_id: string;
  provider: string;
  external_call_id: string;
  direction: 'outbound' | 'inbound';
  outcome: CallOutcome | null;
  duration_seconds: number | null;
  recording_url: string | null;
  transcript: string | null;
  lead_note_id: string | null;
  created_at: string;
}

export interface OrgMemberRow {
  role: Role;
  created_at: string;
  profiles: { id: string; email: string; full_name: string | null; created_at: string };
}

/** parse-notes suggestion: only fields the AI wants to change are present. */
export interface LeadSuggestion {
  stage?: Stage;
  deal_value?: number;
  package_tier?: PackageTier;
  next_action_date?: string;
  next_action_note?: string;
  pain_point?: string;
  /** A customer profile the AI thinks this lead matches (validated against the org's profiles). */
  icp_id?: string;
  rationale: string;
}

/** Same shape as LeadSuggestion's field-update keys, minus the top-level
 * `rationale` string — Dream Agent carries excerpt/rationale on the action itself
 * (DreamAgentAction below), not nested inside the patch. `pain_point` stays
 * display-only, same as it already is for LeadSuggestion/SuggestionDiff — there's
 * no Lead column for it, so it's shown in the diff but never written anywhere. */
export interface DreamAgentUpdatePatch {
  stage?: Stage;
  deal_value?: number;
  package_tier?: PackageTier;
  next_action_date?: string;
  next_action_note?: string;
  pain_point?: string;
  /** A customer profile the AI thinks this lead matches (validated against the org's profiles). */
  icp_id?: string;
  // Details the note states about the lead. For an existing lead these never
  // overwrite: a blank field is filled, and a different email/phone/website/
  // owner_name is kept as an additional detail (see splitContactPatch).
  owner_name?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  city?: string;
  postcode?: string;
  vertical?: string;
}

/** One proposed change from parse-session-notes. `lead_id`/`candidate_lead_ids`
 * always reference ids from the lead index the caller sent — never trust these
 * without validating against that same set client-side (see sanitizeDreamAgentActions
 * in src/lib/dreamAgentActions.ts). */
export type DreamAgentAction =
  | { type: 'update'; lead_id: string; business_name: string; patch: DreamAgentUpdatePatch; excerpt: string; rationale: string }
  | { type: 'create'; extracted: { business_name: string; owner_name: string | null; phone: string | null; email: string | null; website: string | null; city: string | null; vertical: string | null; address?: string | null; postcode?: string | null }; patch: DreamAgentUpdatePatch; excerpt: string; rationale: string }
  | { type: 'ambiguous'; mentioned_text: string; candidate_lead_ids: string[]; excerpt: string }
  | { type: 'update_company_context'; proposed_context: string; excerpt: string; rationale: string };

export type ScrapeJobStatus = 'pending' | 'running' | 'completed' | 'failed';
export type ScrapeSource = 'google_places' | 'companies_house' | 'cro' | 'csv_upload';

export interface ScrapeJob {
  id: string;
  org_id: string;
  /** The customer profile this search was run for; approved leads inherit it. */
  icp_id: string | null;
  icp_raw_input: string | null;
  icp_params: IcpParams | null;
  pipeline_id: string | null;
  sources: ScrapeSource[];
  status: ScrapeJobStatus;
  results_count: number;
  approved_count: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export type RawLeadStatus = 'pending' | 'approved' | 'rejected' | 'duplicate';

export interface RawLead {
  id: string;
  scrape_job_id: string;
  business_name: string;
  owner_name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  postcode: string | null;
  google_rating: number | null;
  review_count: number | null;
  vertical: string | null;
  source: 'google_places' | 'companies_house' | 'cro' | 'csv_upload';
  source_id: string | null;
  raw_data: Record<string, unknown> | null;
  status: RawLeadStatus;
  duplicate_of: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

/** Structured output of parse-icp — country drives the Companies House checkbox gate. */
export interface IcpParams {
  industry: string | null;
  location: string | null;
  city: string | null;
  country: 'GB' | 'US' | 'other';
  min_staff: number | null;
  min_rating: number | null;
  max_rating: number | null;
  max_reviews: number | null;
  keywords: string[];
}

export interface EmailReply {
  id: string;
  email_log_id: string;
  lead_id: string;
  org_id: string;
  from_email: string;
  subject: string | null;
  body: string;
  received_at: string;
}

export type LinkedinContactStatus = 'pending' | 'drafted' | 'approved' | 'sent' | 'skipped';

export interface LinkedinContact {
  id: string;
  org_id: string;
  full_name: string;
  linkedin_url: string | null;
  context_signal: string | null;
  status: LinkedinContactStatus;
  lead_id: string | null;
  decision_maker_candidate_id: string | null;
  created_by: string | null;
  created_at: string;
}

export type LinkedinDraftStatus = 'draft' | 'approved' | 'sent' | 'skipped';

export interface LinkedinDraft {
  id: string;
  contact_id: string;
  org_id: string;
  message: string;
  template_variant: 'achievement' | 'life_update' | 'general';
  status: LinkedinDraftStatus;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  created_at: string;
}

export type AutopilotRunStatus = 'active' | 'completed' | 'cancelled';

/** 'discover' scrapes new leads daily; 'selected' works through a hand-picked lead list (migration 048). */
export type AutopilotMode = 'discover' | 'selected';

export interface AutopilotRun {
  id: string;
  org_id: string;
  /** Discover runs scrape for leads; selected runs only work through autopilot_run_leads. */
  mode: AutopilotMode;
  /** The customer profile this campaign targets; every lead it approves is tagged with it. */
  icp_id: string | null;
  created_by: string;
  icp_raw_input: string;
  icp_params: IcpParams;
  /** Null for selected runs (nothing is scraped). */
  source: ScrapeSource | null;
  daily_lead_target: number | null;
  daily_outreach_target: number | null;
  duration_days: number | null;
  ramp_up_enabled: boolean;
  max_total_spend_cents: number | null;
  started_at: string;
  /** Null for selected runs (they finish when the queue is empty). */
  ends_at: string | null;
  status: AutopilotRunStatus;
  cancel_reason: string | null;
  estimated_cost_low_cents: number;
  estimated_cost_high_cents: number;
  leads_scraped_total: number;
  outreach_sent_total: number;
  actual_ai_cost_cents: number;
  bounce_count: number;
  /** Selected runs only: daily send window as 'HH:MM' in the run's timezone. */
  window_start: string | null;
  window_end: string | null;
  /** IANA timezone name, e.g. 'Europe/London'. */
  timezone: string | null;
  /** The local date the window applies to (YYYY-MM-DD). */
  window_date: string | null;
  daily_send_cap: number | null;
  created_at: string;
}

export type AutopilotRunLeadStatus = 'queued' | 'working' | 'sent' | 'skipped' | 'needs_input' | 'failed' | 'not_reached';

/** One lead's place in a selected-mode autopilot run (migration 048). */
export interface AutopilotRunLead {
  id: string;
  run_id: string;
  lead_id: string;
  org_id: string;
  status: AutopilotRunLeadStatus;
  reason: string | null;
  email_log_id: string | null;
  sequence_id: string | null;
  claimed_at: string | null;
  updated_at: string;
}

export interface OutreachBlocklistEntry {
  id: string;
  org_id: string;
  value: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

/** An org's ideal customer profile: who it sells to, and what resonates with them (migration 044). */
export interface IdealCustomerProfile {
  id: string;
  org_id: string;
  name: string;
  summary: string | null;
  pain_points: string | null;
  goals: string | null;
  objections: string | null;
  messaging_notes: string | null;
  extra_context: string | null;
  created_at: string;
  updated_at: string;
}
