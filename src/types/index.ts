export type Role = 'admin' | 'contractor' | 'team_member';

export type PlatformRole = 'platform_admin' | 'user';

export interface OrgMembership {
  id: string;
  name: string;
  role: Role;
}

export type Stage =
  | 'new_lead' | 'contacted' | 'audit_booked' | 'proposal_sent'
  | 'negotiating' | 'won' | 'lost' | 'not_now_nurture';

export type PackageTier =
  | 'pilot_systems' | 'pilot_ai_app' | 'pilot_full_build'
  | 'automation_sprint' | 'ai_foundation' | 'full_build'
  | 'retainer_bronze' | 'retainer_silver' | 'retainer_gold' | 'custom';

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
  website: string | null;
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
export type EnrichableField = 'email' | 'phone' | 'owner_name';

export interface EnrichmentResult {
  lead_id: string;
  proposed: Partial<Record<EnrichableField, string>>;
  source: Partial<Record<EnrichableField, string>>;
}

export interface DecisionMakerCandidate {
  id: string;
  lead_id: string;
  source: 'hunter' | 'apollo';
  apollo_person_id: string | null;
  first_name: string | null;
  last_name: string | null;
  name_obfuscated: boolean;
  title: string | null;
  email: string | null;
  email_revealed: boolean;
  phone: string | null;
  phone_status: 'not_requested' | 'pending' | 'revealed' | 'not_found' | 'failed';
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
}

export interface SequenceStep {
  delay_days: number;
  template_type: TemplateType;
  subject_override: string | null;
}

export interface EmailSequence {
  id: string;
  name: string;
  description: string | null;
  steps: SequenceStep[];
  is_default: boolean;
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
}

/** One proposed change from parse-session-notes. `lead_id`/`candidate_lead_ids`
 * always reference ids from the lead index the caller sent — never trust these
 * without validating against that same set client-side (see sanitizeDreamAgentActions
 * in src/lib/dreamAgentActions.ts). */
export type DreamAgentAction =
  | { type: 'update'; lead_id: string; business_name: string; patch: DreamAgentUpdatePatch; excerpt: string; rationale: string }
  | { type: 'create'; extracted: { business_name: string; owner_name: string | null; phone: string | null; email: string | null; website: string | null; city: string | null; vertical: string | null }; excerpt: string; rationale: string }
  | { type: 'ambiguous'; mentioned_text: string; candidate_lead_ids: string[]; excerpt: string }
  | { type: 'update_company_context'; proposed_context: string; excerpt: string; rationale: string };

export type ScrapeJobStatus = 'pending' | 'running' | 'completed' | 'failed';
export type ScrapeSource = 'google_places' | 'companies_house' | 'csv_upload';

export interface ScrapeJob {
  id: string;
  org_id: string;
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
  source: 'google_places' | 'companies_house' | 'csv_upload';
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

export interface AutopilotRun {
  id: string;
  org_id: string;
  created_by: string;
  icp_raw_input: string;
  icp_params: IcpParams;
  source: ScrapeSource;
  daily_lead_target: number;
  daily_outreach_target: number;
  duration_days: number;
  ramp_up_enabled: boolean;
  max_total_spend_cents: number | null;
  started_at: string;
  ends_at: string;
  status: AutopilotRunStatus;
  cancel_reason: string | null;
  estimated_cost_low_cents: number;
  estimated_cost_high_cents: number;
  leads_scraped_total: number;
  outreach_sent_total: number;
  actual_ai_cost_cents: number;
  bounce_count: number;
  created_at: string;
}

export interface OutreachBlocklistEntry {
  id: string;
  org_id: string;
  value: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}
