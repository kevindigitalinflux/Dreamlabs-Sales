import {supabase} from './supabase';
import {enrollErrorMessage} from '../../supabase/functions/_shared/enrollmentErrors';
import {moveToStep,nextSendAtFor} from './sequenceMath';
import type {EmailSequence} from '../types';
/** Shared single-lead enrollment path for review and composer follow-up. */
export async function enrollLead(leadId:string,sequenceId:string,userId:string|undefined,startStep=1):Promise<string|null> {
    const { data: seq } = await supabase.from('email_sequences').select('*').eq('id', sequenceId).eq('is_active', true).single();
    if (!seq) return 'Sequence not found';
    const steps = (seq as EmailSequence).steps;
    // Starting part-way in: the chosen step is the next one drafted, after its own usual wait.
    const start = startStep > 1
      ? moveToStep(steps, startStep, new Date(), false)
      : { current_step: 1, next_send_at: nextSendAtFor(new Date(), steps, 1) };
    const { error } = await supabase.from('sequence_enrollments').insert({
      lead_id: leadId, sequence_id: sequenceId, ...start,
      status: 'active', enrolled_by: userId,
    });
    if (error) return enrollErrorMessage(error);
    return null;
}
