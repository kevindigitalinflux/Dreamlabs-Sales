export type Role = 'admin' | 'contractor';

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
  next_action_date: string | null;
  next_action_note: string | null;
  call_count: number;
  last_contacted_at: string | null;
  kanban_position: number;
  created_at: string;
  updated_at: string;
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

export type ScrapeJobStatus = 'pending' | 'running' | 'completed' | 'failed';
export type ScrapeSource = 'google_places' | 'companies_house';

export interface ScrapeJob {
  id: string;
  org_id: string;
  icp_raw_input: string | null;
  icp_params: IcpParams | null;
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
  source: 'google_places' | 'companies_house';
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
