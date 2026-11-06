import {useRef,useState} from 'react';
import {useNavigate} from 'react-router';
import {Upload} from 'lucide-react';
import {parseCsv} from '../../lib/csv';
import {useOrg} from '../../hooks/useOrg';
import {usePipeline} from '../../hooks/usePipeline';
import {supabase} from '../../lib/supabase';
import {Button} from '../ui/Button';
import {SelectField} from '../ui/Input';
export function DreamAgentCsv() {
 const {currentOrg}=useOrg();const {pipelines}=usePipeline();const navigate=useNavigate();
 const orgPipelines=pipelines.filter(p=>p.org_id===currentOrg?.id);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPipelineChoice, setCsvPipelineChoice] = useState<'existing' | 'new'>('existing');
  const [csvPipelineId, setCsvPipelineId] = useState('');
  const [csvNewPipelineName, setCsvNewPipelineName] = useState('');
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvDragActive, setCsvDragActive] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);
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

return (
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
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv"
            onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
            className="hidden"
          />
          <div
            role="button"
            tabIndex={0}
            onClick={() => csvInputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') csvInputRef.current?.click(); }}
            onDragOver={(e) => { e.preventDefault(); setCsvDragActive(true); }}
            onDragLeave={() => setCsvDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setCsvDragActive(false);
              const file = e.dataTransfer.files?.[0];
              if (file) setCsvFile(file);
            }}
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${csvDragActive ? 'border-cyan bg-cyan/5' : 'border-line hover:border-cyan/60'}`}
          >
            <Upload className="h-6 w-6 text-muted" aria-hidden />
            {csvFile ? (
              <p className="text-sm font-semibold">{csvFile.name}</p>
            ) : (
              <>
                <p className="text-sm font-semibold">Click to upload or drag and drop</p>
                <p className="text-xs text-muted">CSV files only</p>
              </>
            )}
          </div>
          {csvError && <p role="alert" className="text-sm text-danger">{csvError}</p>}
          <Button
            onClick={() => void handleCsvUpload()}
            disabled={csvBusy || !csvFile || (csvPipelineChoice === 'existing' && !csvPipelineId) || (csvPipelineChoice === 'new' && !csvNewPipelineName.trim())}
            loading={csvBusy}
          >
            {csvBusy ? 'Uploading…' : 'Upload and review'}
          </Button>
        </div>
      );
}
