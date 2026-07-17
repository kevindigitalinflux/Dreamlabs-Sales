import { Fragment, useEffect, useMemo, useState } from 'react';
import { Mail } from 'lucide-react';
import { useEmailLogs } from '../../hooks/useEmailLogs';
import { useProfiles } from '../../hooks/useProfiles';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { toCsv } from '../../lib/csv';
import { formatShortDate, initials } from '../../lib/utils';
import type { EmailLog, EmailLogStatus } from '../../types';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { SelectField } from '../ui/Input';

interface LogFilters {
  search: string;
  contractorId: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: LogFilters = { search: '', contractorId: '', from: '', to: '' };

const STATUS_CLASSES: Record<EmailLogStatus, string> = {
  draft: 'bg-surface text-muted',
  sent: 'bg-emerald-500/15 text-emerald-400',
  failed: 'bg-red-500/15 text-red-400',
};

function exportCsv(rows: EmailLog[], companyOf: (id: string | null) => string) {
  const csv = toCsv(
    ['Date', 'Company', 'To', 'Subject', 'Status', 'Sent by'],
    rows.map((l) => [l.sent_at, companyOf(l.lead_id), l.to_email, l.subject, l.status, l.sent_by ?? '']),
  );
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'email-logs.csv';
  a.click();
  URL.revokeObjectURL(url);
}

interface FilterRowProps {
  filters: LogFilters;
  onChange: (filters: LogFilters) => void;
  contractors: { id: string; label: string }[];
  isAdmin: boolean;
  onExport: () => void;
}

/** Search + admin-only contractor select + date bounds + CSV export, above the log table. */
function FilterRow({ filters, onChange, contractors, isAdmin, onExport }: FilterRowProps) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <input
        type="search"
        aria-label="Search company or subject"
        placeholder="Search company, subject…"
        value={filters.search}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
        className="min-h-11 min-w-56 flex-1 rounded-lg border border-line bg-surface px-3 text-base outline-none placeholder:text-muted focus:border-cyan"
      />
      {isAdmin && (
        <SelectField
          label="Contractor"
          value={filters.contractorId}
          onChange={(e) => onChange({ ...filters, contractorId: e.target.value })}
        >
          <option value="">All contractors</option>
          {contractors.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </SelectField>
      )}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-muted" htmlFor="log-from">From</label>
        <input id="log-from" type="date" value={filters.from} onChange={(e) => onChange({ ...filters, from: e.target.value })}
          className="min-h-11 rounded-lg border border-line bg-surface px-3 text-base outline-none focus:border-cyan" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-muted" htmlFor="log-to">To</label>
        <input id="log-to" type="date" value={filters.to} onChange={(e) => onChange({ ...filters, to: e.target.value })}
          className="min-h-11 rounded-lg border border-line bg-surface px-3 text-base outline-none focus:border-cyan" />
      </div>
      <Button variant="secondary" onClick={onExport}>Export CSV</Button>
    </div>
  );
}

/** Email log tab: filterable table of sent/draft/failed emails, row expands to the full body, CSV export. */
export function EmailLogList() {
  const { logs, loading, error } = useEmailLogs();
  const { profiles } = useProfiles();
  const { profile } = useAuth();
  const [leadNames, setLeadNames] = useState<Map<string, string>>(new Map());
  const [filters, setFilters] = useState<LogFilters>(EMPTY_FILTERS);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    void supabase.from('leads').select('id, business_name').then(({ data }) => {
      if (data) setLeadNames(new Map(data.map((l) => [l.id as string, l.business_name as string])));
    });
  }, []);

  function companyOf(id: string | null): string {
    return (id && leadNames.get(id)) || '—';
  }

  function senderOf(id: string | null): string {
    const p = profiles.find((x) => x.id === id);
    return p ? initials(p.full_name ?? p.email) : '—';
  }

  const filtered = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return logs.filter((l) => {
      if (search && !companyOf(l.lead_id).toLowerCase().includes(search) && !l.subject.toLowerCase().includes(search)) return false;
      if (filters.contractorId && l.sent_by !== filters.contractorId) return false;
      if (filters.from && l.sent_at.slice(0, 10) < filters.from) return false;
      if (filters.to && l.sent_at.slice(0, 10) > filters.to) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, filters, leadNames]);

  if (loading) return <Skeleton className="h-40 w-full" />;
  if (error) return <p role="alert" className="text-sm text-red-400">{error}</p>;
  if (logs.length === 0) return <EmptyState icon={Mail} title="No emails yet" hint="Emails you send appear here." />;

  return (
    <div className="flex flex-col gap-3">
      <FilterRow
        filters={filters}
        onChange={setFilters}
        contractors={profiles.map((p) => ({ id: p.id, label: p.full_name ?? p.email }))}
        isAdmin={profile?.role === 'admin'}
        onExport={() => exportCsv(filtered, companyOf)}
      />
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-navy">
            <tr className="border-b border-line text-xs font-semibold text-muted">
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Subject</th>
              <th className="px-3 py-2">Sent by</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((log) => {
              const expanded = expandedId === log.id;
              return (
                <Fragment key={log.id}>
                  <tr onClick={() => setExpandedId(expanded ? null : log.id)}
                    className="cursor-pointer border-b border-line last:border-0 hover:bg-surface/50">
                    <td className="px-3 py-3 text-muted">{formatShortDate(log.sent_at)}</td>
                    <td className="px-3 py-3 font-semibold">{companyOf(log.lead_id)}</td>
                    <td className="max-w-xs truncate px-3 py-3">{log.subject}</td>
                    <td className="px-3 py-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-purple text-[10px] font-bold">
                        {senderOf(log.sent_by)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        title={log.status === 'failed' ? (log.error_message ?? undefined) : undefined}
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${STATUS_CLASSES[log.status]}`}
                      >
                        {log.status}
                      </span>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="border-b border-line bg-surface/30 last:border-0">
                      <td colSpan={5} className="whitespace-pre-wrap px-3 py-3 text-sm">
                        <p className="mb-1 text-xs text-muted">To: {log.to_email}</p>
                        {log.body}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
