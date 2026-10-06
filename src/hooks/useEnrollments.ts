import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { moveToStep, nextSendAtFor } from '../lib/sequenceMath';
import type { EmailSequence, SequenceEnrollment } from '../types';

type EnrollmentWithSequence = SequenceEnrollment & { sequence: EmailSequence };

/** The lead's current (non-cancelled/completed) enrollment, if any. */
export function useEnrollments(leadId: string) {
  const { session } = useAuth();
  const [enrollment, setEnrollment] = useState<EnrollmentWithSequence | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from('sequence_enrollments')
      .select('*, sequence:email_sequences(*)')
      .eq('lead_id', leadId)
      .in('status', ['active', 'paused'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setEnrollment(data as EnrollmentWithSequence | null);
    setLoading(false);
  }, [leadId]);

  useEffect(() => { setLoading(true); void refresh(); }, [refresh]);

  const enroll = useCallback(async (sequenceId: string, startStep = 1): Promise<string | null> => {
    const { data: seq } = await supabase.from('email_sequences').select('*').eq('id', sequenceId).single();
    if (!seq) return 'Sequence not found';
    const steps = (seq as EmailSequence).steps;
    // Starting part-way in: the chosen step is the next one drafted, after its own usual wait.
    const start = startStep > 1
      ? moveToStep(steps, startStep, new Date(), false)
      : { current_step: 1, next_send_at: nextSendAtFor(new Date(), steps, 1) };
    const { error } = await supabase.from('sequence_enrollments').insert({
      lead_id: leadId, sequence_id: sequenceId, ...start,
      status: 'active', enrolled_by: session?.user.id,
    });
    if (error) return error.message;
    await refresh();
    return null;
  }, [leadId, session, refresh]);

  const setStatus = useCallback(async (status: 'active' | 'paused' | 'cancelled'): Promise<string | null> => {
    if (!enrollment) return 'No enrollment';
    const { error } = await supabase.from('sequence_enrollments').update({ status }).eq('id', enrollment.id);
    if (error) return error.message;
    await refresh();
    return null;
  }, [enrollment, refresh]);

  /** Jump the enrollment to a step (the one drafted next); `immediate` drafts it on the next engine run. */
  const goToStep = useCallback(async (step: number, immediate: boolean): Promise<string | null> => {
    if (!enrollment) return 'No enrollment';
    const { error } = await supabase.from('sequence_enrollments')
      .update(moveToStep(enrollment.sequence.steps, step, new Date(), immediate))
      .eq('id', enrollment.id).select().single();
    if (error) return error.message;
    await refresh();
    return null;
  }, [enrollment, refresh]);

  return { enrollment, loading, enroll, setStatus, goToStep };
}
