import { useMemo } from 'react';
import { useOrg } from './useOrg';
import { buildPostSendPreview } from '../lib/postSendPreview';
import { localDateString } from '../../supabase/functions/_shared/autopilotEligibility';
import type { EmailSequence, EmailTemplate, SequenceEnrollment } from '../types';

/** The already-loaded data the preview reads; the caller loads it once and shares it with the template picker. */
export interface PostSendPreviewData {
  templates: EmailTemplate[];
  sequences: EmailSequence[];
  enrollment: SequenceEnrollment | null;
  /** True while any of the three is still loading. */
  loading: boolean;
}

/**
 * Plain-English "What happens after sending" lines for one lead and the chosen template, or null while loading or
 * when no template is chosen (nothing is better than something misleading). The caller passes the data it already
 * loaded (RLS-scoped reads), so enrolling from the composer is reflected straight away.
 */
export function usePostSendPreview(
  data: PostSendPreviewData, templateId: string, nextActionDate: string | null, subject: string, recipientLabel: string,
): string[] | null {
  const { currentOrg } = useOrg();
  const { templates, sequences, enrollment, loading } = data;
  const orgId = currentOrg?.id;
  return useMemo(() => {
    if (!orgId || loading || !templateId) return null;
    const now = new Date();
    return buildPostSendPreview({
      orgId, templateId,
      templates: templates.map((t) => ({ id: t.id, org_id: (t as { org_id?: string | null }).org_id ?? null, template_type: t.template_type, is_default: t.is_default })),
      sequences, enrollment, currentNextActionDate: nextActionDate,
      todayLocal: localDateString(now, 'Europe/London'), now, subject, recipientLabel,
    });
  }, [orgId, loading, templateId, templates, sequences, enrollment, nextActionDate, subject, recipientLabel]);
}
