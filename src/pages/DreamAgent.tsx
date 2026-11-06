import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { Send, Sparkles } from 'lucide-react';
import { useDreamAgentSession } from '../hooks/useDreamAgentSession';
import { useVoiceDictation } from '../hooks/useVoiceDictation';
import { useIcps } from '../hooks/useIcps';
import { VoiceButton, VoiceStatus, voiceFieldClass } from '../components/ui/VoiceControls';
import { usePersistedState } from '../hooks/usePersistedState';
import { usePipeline } from '../hooks/usePipeline';
import { useOrg } from '../hooks/useOrg';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui/Button';
import { SelectField, Textarea } from '../components/ui/Input';
import {AgentActionReview} from '../components/dreamAgent/AgentActionReview';
import {DreamAgentCsv} from '../components/dreamAgent/DreamAgentCsv';
import type { Lead } from '../types';
/** Dream Agent: free-form session notes (typed or voice) parsed into confirm-before-
 * apply lead updates across however many leads a note touches. */
export function DreamAgent() {
  const { currentOrg } = useOrg();
  const { currentPipeline, pipelines } = usePipeline();
  const { messages, actions, resolutions, loading, error, contactIndex, contactReport, round, sendMessage, resolveAction, confirmAll,applyErrors,applySummary } = useDreamAgentSession();
  const location = useLocation();
  const [tab, setTab] = useState<'notes' | 'csv'>(() => ((location.state as { tab?: 'notes' | 'csv' } | null)?.tab === 'csv' ? 'csv' : 'notes'));
  // Persisted per org: what's been typed survives a trip to another screen
  // (e.g. to look up a lead's name) and only clears on send or manual delete.
  const [draft, setDraft] = usePersistedState(`dream-agent:draft:${currentOrg?.id ?? 'none'}`, '');
  const [matchScope, setMatchScope] = useState<string>(currentPipeline?.id ?? '');
  const [leadsById, setLeadsById] = useState<Record<string, Lead>>({});

  // Shared with the note dialog: live transcript, appended to what's already typed.
  const voice = useVoiceDictation(draft, setDraft);
  const { icps } = useIcps();
  const icpNames = Object.fromEntries(icps.map((p) => [p.id, p.name]));

  const orgPipelines = pipelines.filter((p) => p.org_id === currentOrg?.id);
  const matchPipelineId = matchScope || null;

  /** Refreshes the lead lookup used to render "from" values and candidate names on action rows. */
  const refreshLeads = useCallback(async () => {
    if (!currentOrg) return;
    let query = supabase.from('leads').select('*').eq('org_id', currentOrg.id);
    if (matchPipelineId) query = query.eq('pipeline_id', matchPipelineId);
    const { data } = await query;
    const byId: Record<string, Lead> = {};
    for (const l of (data as Lead[] | null) ?? []) byId[l.id] = l;
    setLeadsById(byId);
  }, [currentOrg, matchPipelineId]);

  // Coming back to the page with restored actions: re-fetch the lookup, since it
  // isn't persisted and the rows would otherwise render without "from" values.
  useEffect(() => {
    if (actions.length > 0) void refreshLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrg?.id]);

  async function handleSend() {
    if (!draft.trim()) return;
    if (voice.isListening) voice.stop();
    const text = draft;
    setDraft('');
    await sendMessage(text, matchPipelineId);
    await refreshLeads();
  }

  /**
   * The user picked which lead an "ambiguous" mention meant. An ambiguous action
   * carries no field changes of its own, so instead of only logging a note, feed
   * the choice back as a clarification and let the AI re-propose a real update
   * for that lead (stage, package, next action…) — same refinement loop as typing
   * a correction. Note this re-proposes the whole list, so other rows go back to
   * unconfirmed.
   */
  async function handleClarify(mentionedText: string, leadId: string) {
    const name = leadsById[leadId]?.business_name ?? leadId;
    await sendMessage(`Clarification: "${mentionedText}" means ${name} (lead id ${leadId}). Apply what I said about it to that lead.`, matchPipelineId);
    await refreshLeads();
  }

  const anyConfirmed = Object.values(resolutions).some((r) => r.status.startsWith('confirmed_'));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <header className="flex items-center gap-3">
        <Sparkles className="h-6 w-6 text-cyan" aria-hidden />
        <h1 className="text-[28px] font-extrabold">Dream Agent</h1>
      </header>

      <div className="flex overflow-hidden rounded-lg border border-line" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'notes'} onClick={() => setTab('notes')} className={`min-h-11 flex-1 cursor-pointer text-sm font-semibold ${tab === 'notes' ? 'bg-violet/25' : 'text-muted'}`}>
          Session notes
        </button>
        <button type="button" role="tab" aria-selected={tab === 'csv'} onClick={() => setTab('csv')} className={`min-h-11 flex-1 cursor-pointer text-sm font-semibold ${tab === 'csv' ? 'bg-violet/25' : 'text-muted'}`}>
          Upload CSV
        </button>
      </div>

      {tab==='csv'&&<DreamAgentCsv />}

      {tab === 'notes' && (
      <>

      <div className="flex flex-col gap-4">
        {messages.map((m, i) => (
          <p key={i} className="rounded-xl border border-line bg-surface/60 p-4 text-sm">{m}</p>
        ))}
        <AgentActionReview key={`${currentOrg?.id}:${round}`} actions={actions} resolutions={resolutions} busy={loading} onResolve={resolveAction} applyErrors={applyErrors}
          onPickLead={(index,id)=>{const action=actions[index];if(action.type==='ambiguous')void handleClarify(action.mentioned_text,id);}}
          rowProps={{leadsById,pipelines:orgPipelines,scopedPipelineId:matchPipelineId,needsPipelinePicker:!matchPipelineId,isOrgAdmin:currentOrg?.role==='admin',icpNames,contactsByLead:contactIndex,messages}} />
        {actions.length > 0 && (
          <div className="flex justify-end">
            <Button onClick={() => void confirmAll()} disabled={!anyConfirmed || loading} loading={loading}>
              {loading ? 'Applying…' : 'Apply confirmed changes'}
            </Button>
          </div>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {applySummary&&<p role="status" className="text-sm">{applySummary}</p>}
      {contactReport.failed.map((m) => <p key={m} role="alert" className="text-sm text-danger">{m}</p>)}
      {contactReport.notes.map((m) => <p key={m} role="status" className="text-sm text-muted">{m}</p>)}

      <div className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4">
        <SelectField label="Match against" value={matchScope} onChange={(e) => setMatchScope(e.target.value)}>
          <option value="">Whole platform</option>
          {orgPipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectField>
        <Textarea
          label={messages.length === 0 ? 'What happened in your session?' : 'Add a correction or more detail'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          className={voiceFieldClass(voice)}
        />
        <VoiceStatus voice={voice} />
        <div className="flex items-center justify-between">
          <VoiceButton voice={voice} />
          <Button onClick={() => void handleSend()} disabled={!draft.trim() || loading} loading={loading}>
            <Send className="h-4 w-4" aria-hidden />
            {loading ? 'Thinking…' : 'Send'}
          </Button>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
