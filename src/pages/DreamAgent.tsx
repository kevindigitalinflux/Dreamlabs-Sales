import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Mic, Send, Sparkles } from 'lucide-react';
import { parseCsv } from '../lib/csv';
import { useDreamAgentSession } from '../hooks/useDreamAgentSession';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { usePipeline } from '../hooks/usePipeline';
import { useOrg } from '../hooks/useOrg';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui/Button';
import { SelectField, Textarea } from '../components/ui/Input';
import { ActionRow } from '../components/dreamAgent/ActionRow';
import type { Lead } from '../types';

/** Dream Agent: free-form session notes (typed or voice) parsed into confirm-before-
 * apply lead updates across however many leads a note touches. */
export function DreamAgent() {
  const { currentOrg } = useOrg();
  const { currentPipeline, pipelines } = usePipeline();
  const { messages, actions, resolutions, loading, error, sendMessage, resolveAction, confirmAll } = useDreamAgentSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [tab, setTab] = useState<'notes' | 'csv'>(() => ((location.state as { tab?: 'notes' | 'csv' } | null)?.tab === 'csv' ? 'csv' : 'notes'));
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPipelineChoice, setCsvPipelineChoice] = useState<'existing' | 'new'>('existing');
  const [csvPipelineId, setCsvPipelineId] = useState('');
  const [csvNewPipelineName, setCsvNewPipelineName] = useState('');
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [matchScope, setMatchScope] = useState<string>(currentPipeline?.id ?? '');
  const [leadsById, setLeadsById] = useState<Record<string, Lead>>({});

  const { isSupported: micSupported, isListening, start, stop } = useSpeechRecognition((text) => setDraft(text));

  const orgPipelines = pipelines.filter((p) => p.org_id === currentOrg?.id);
  const matchPipelineId = matchScope || null;

  async function handleSend() {
    if (!draft.trim()) return;
    const text = draft;
    setDraft('');
    await sendMessage(text, matchPipelineId);
    // Refresh the lead lookup used to render "from" values on update rows.
    if (!currentOrg) return;
    let query = supabase.from('leads').select('*').eq('org_id', currentOrg.id);
    if (matchPipelineId) query = query.eq('pipeline_id', matchPipelineId);
    const { data } = await query;
    const byId: Record<string, Lead> = {};
    for (const l of (data as Lead[] | null) ?? []) byId[l.id] = l;
    setLeadsById(byId);
  }

  async function handleCsvUpload() {
    if (!csvFile || !currentOrg) return;
    setCsvBusy(true); setCsvError(null);
    const text = await csvFile.text();
    const rows = parseCsv(text);
    if (rows.length < 2) { setCsvBusy(false); setCsvError('This file has no data rows.'); return; }
    const [csvHeaders, ...dataRows] = rows;
    const { data, error: invokeErr } = await supabase.functions.invoke('parse-csv-leads', {
      body: {
        org_id: currentOrg.id,
        pipeline_id: csvPipelineChoice === 'existing' ? csvPipelineId : undefined,
        pipeline_is_new: csvPipelineChoice === 'new',
        pipeline_name: csvPipelineChoice === 'new' ? csvNewPipelineName : undefined,
        csv_headers: csvHeaders, rows: dataRows,
      },
    });
    setCsvBusy(false);
    if (invokeErr) { setCsvError(invokeErr.message); return; }
    const result = data as { job_id?: string; error?: string };
    if (result.error) { setCsvError(result.error); return; }
    if (result.job_id) navigate(`/scraper/jobs/${result.job_id}`);
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

      {tab === 'csv' && (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4">
          <label className="flex min-h-11 items-center gap-2">
            <input type="radio" name="csv-pipeline-choice" checked={csvPipelineChoice === 'existing'} onChange={() => setCsvPipelineChoice('existing')} className="h-4 w-4 accent-violet-500" />
            Add to an existing pipeline
          </label>
          {csvPipelineChoice === 'existing' && (
            <SelectField label="Pipeline" value={csvPipelineId} onChange={(e) => setCsvPipelineId(e.target.value)}>
              <option value="">Choose pipeline…</option>
              {orgPipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </SelectField>
          )}
          <label className="flex min-h-11 items-center gap-2">
            <input type="radio" name="csv-pipeline-choice" checked={csvPipelineChoice === 'new'} onChange={() => setCsvPipelineChoice('new')} className="h-4 w-4 accent-violet-500" />
            Create a new pipeline
          </label>
          {csvPipelineChoice === 'new' && (
            <input type="text" placeholder="New pipeline name" value={csvNewPipelineName} onChange={(e) => setCsvNewPipelineName(e.target.value)} className="min-h-11 rounded-lg border border-line bg-surface px-3 text-base outline-none focus:border-cyan" />
          )}
          <input type="file" accept=".csv" onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)} className="text-sm" />
          {csvError && <p role="alert" className="text-sm text-danger">{csvError}</p>}
          <Button
            onClick={() => void handleCsvUpload()}
            disabled={csvBusy || !csvFile || (csvPipelineChoice === 'existing' && !csvPipelineId) || (csvPipelineChoice === 'new' && !csvNewPipelineName.trim())}
          >
            {csvBusy ? 'Uploading…' : 'Upload and review'}
          </Button>
        </div>
      )}

      {tab === 'notes' && (
      <>

      <div className="flex flex-col gap-4">
        {messages.map((m, i) => (
          <p key={i} className="rounded-xl border border-line bg-surface/60 p-4 text-sm">{m}</p>
        ))}
        {actions.map((action, i) => (
          <ActionRow
            key={i}
            action={action}
            resolution={resolutions[i] ?? { status: 'pending' }}
            leadsById={leadsById}
            pipelines={orgPipelines}
            scopedPipelineId={matchPipelineId}
            needsPipelinePicker={!matchPipelineId}
            onResolve={(resolution) => resolveAction(i, resolution)}
          />
        ))}
        {actions.length > 0 && (
          <div className="flex justify-end">
            <Button onClick={() => void confirmAll()} disabled={!anyConfirmed || loading}>
              {loading ? 'Applying…' : 'Apply confirmed changes'}
            </Button>
          </div>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

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
        />
        <div className="flex items-center justify-between">
          {micSupported && (
            <Button variant={isListening ? 'secondary' : 'ghost'} onClick={() => (isListening ? stop() : start())}>
              <Mic className="h-4 w-4" aria-hidden />
              {isListening ? 'Listening…' : 'Voice note'}
            </Button>
          )}
          <Button onClick={() => void handleSend()} disabled={!draft.trim() || loading}>
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
