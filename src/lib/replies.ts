import type { Lead } from '../types';
export interface EmailReply {
  id: string; lead_id: string; org_id: string; from_email: string; subject: string | null; body: string; preview: string;
  received_at: string; message_id: string | null; opt_out_suspected: boolean; handled_at: string | null;
  attachment_count: number; ai_draft_log_id: string | null; lead: Lead | null;
  original: { id: string; subject: string; body: string; sent_at: string; to_email: string } | null;
  draft: { id: string; status: string; subject: string; body: string } | null;
}
