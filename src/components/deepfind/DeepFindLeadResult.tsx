import {Link} from 'react-router';
import {geminiRefusalHref} from '../../../supabase/functions/_shared/geminiAdmission';
import { AlertTriangle, CheckCircle2, ChevronDown, CircleSlash, Clock, Loader2, MailCheck, MailX, XCircle } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { DEEP_FIND_STATUS_LABELS } from '../../lib/deepFindView';
import { PRIORITY_LABEL, deepFindRowFlags, type DeepFindPriority } from '../../lib/deepFindPriority';
import type { DeepFindRowWithLead } from '../../hooks/useDeepFindRun';
import { DeepFindCompanyChoice } from './DeepFindCompanyChoice';
import { CompanyDomainsEditor } from './CompanyDomainsEditor';
import { DeepFindSuggestions } from './DeepFindSuggestions';
import { DeepFindAutoChanges } from './DeepFindAutoChanges';
import { BlockedOwnDomainNotice } from './BlockedOwnDomainNotice';
import { Heading } from './Heading';
import { RestorePersonButton } from '../pipeline/RestorePersonButton';
import { joinNames } from '../../lib/restoreDismissed';
import { QueuedChecksLine } from './QueuedChecksLine';

const STATUS_ICONS: Record<DeepFindRowWithLead['status'], ReactNode> = {
  queued: <Clock size={14} aria-hidden />,
  running: <Loader2 size={14} aria-hidden className="animate-spin motion-reduce:animate-none" />,
  done: <CheckCircle2 size={14} aria-hidden />,
  failed: <XCircle size={14} aria-hidden />,
  skipped: <CircleSlash size={14} aria-hidden />,
};

const STATUS_CLASSES: Record<DeepFindRowWithLead['status'], string> = {
  queued: 'border-line bg-raised',
  running: 'border-violet-line bg-violet-soft',
  done: 'border-green-500/50 bg-green-500/10',
  failed: 'border-red-500/50 bg-red-500/10',
  skipped: 'border-line bg-raised',
};

/** Left edge and pill colours by how much the lead needs the user: magenta for most, violet to review, quiet for nothing. */
const PRIORITY_EDGE: Record<DeepFindPriority, string> = {
  most: 'border-line border-l-attention',
  some: 'border-line border-l-violet-line',
  working: 'border-line border-l-line',
  none: 'border-line border-l-line',
};
const PRIORITY_PILL: Record<DeepFindPriority, string> = {
  most: 'bg-attention-soft text-attention',
  some: 'bg-violet-soft text-link',
  working: 'bg-surface text-muted',
  none: 'bg-surface text-muted',
};

/** One titled block inside a lead result. */
function Section({ title, level, children }: { title: string; level: number; children: ReactNode }) {
  return <section className="flex min-w-0 flex-col gap-2">
    <Heading level={level} className="font-heading text-sm font-bold">{title}</Heading>
    {children}
  </section>;
}

/**
 * One lead's Deep find result: status, what each step found in plain English, a website warning, the company
 * domains (each removable with "Not their domain"), the Companies House choice when unclear, the people looked up
 * with their role, and the names to check.
 */
export function DeepFindLeadResult({ row, level = 2 }: { row: DeepFindRowWithLead; level?: number }) {
  const { details, registrySkipped, openChoice, toCheck, toReview, priority } = deepFindRowFlags(row);
  // Leads that need a decision open by themselves; the rest stay folded until asked for.
  const [open, setOpen] = useState(priority === 'most');
  return (
    <li className={`flex min-w-0 flex-col gap-4 rounded-surface border border-l-4 bg-raised p-4 text-sm text-offwhite shadow-raised ${PRIORITY_EDGE[priority]}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Heading level={level} className="min-w-0 flex-1 font-heading text-base font-bold">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-11 w-full cursor-pointer items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-focus">
            <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} aria-hidden />
            <span className="break-words">{row.lead?.business_name ?? 'A lead you cannot see'}</span>
          </button>
        </Heading>
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${PRIORITY_PILL[priority]}`}>{PRIORITY_LABEL[priority]}{toReview > 0 && priority === 'some' ? `: ${toReview}` : ''}</span>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[row.status]}`}>{STATUS_ICONS[row.status]}{DEEP_FIND_STATUS_LABELS[row.status]}</span>
        {row.status === 'done' && (
          <span className="inline-flex items-center rounded-full border border-line bg-raised px-2.5 py-1 text-xs font-semibold">{row.people_found === 1 ? '1 person added' : `${row.people_found} people added`}</span>
        )}
      </div>
      {open && <div className="flex min-w-0 flex-col gap-4">
      {row.lead && <BlockedOwnDomainNotice leadId={row.lead_id} lead={row.lead} />}
      {row.reason && <p>{row.reason}</p>}
      {openChoice && (
        <section className="flex flex-col gap-2 rounded-surface border-2 border-violet-line bg-violet-soft p-3.5">
          <Heading level={level + 1} className="flex items-center gap-2 font-heading text-base font-bold"><AlertTriangle size={18} aria-hidden className="shrink-0" />Needs your decision: choose the right company</Heading>
          <p className="text-[13px]">
            Deep find carried on with everything else. Only the company&apos;s officers wait for this: once you choose, they are
            added and looked up on the confirmed domains.
          </p>
          <DeepFindCompanyChoice leadId={row.lead_id} candidates={details.companyCandidates} />
        </section>
      )}
      {registrySkipped && <p role="status">{registrySkipped === 'not_uk' ? 'Companies House skipped: this is not a UK company.' : 'Company matches dismissed for this lead.'}</p>}
      {details.websiteSuspect && (
        <p role="status" className="flex items-start gap-2 rounded-surface border-2 border-amber-500/60 bg-amber-500/10 p-3">
          <AlertTriangle size={18} aria-hidden className="mt-0.5 shrink-0" />
          <span><span className="font-semibold">Check the website: </span>This website may belong to a different company. {details.websiteReasons.join(' ')}</span>
        </p>
      )}
      {details.dismissedPeople.length > 0 && (
        <section className="flex flex-col gap-2 rounded-surface border-2 border-amber-500/60 bg-amber-500/10 p-3" aria-label="Dismissed people skipped">
          <p className="flex items-start gap-2">
            <AlertTriangle size={18} aria-hidden className="mt-0.5 shrink-0" />
            <span><span className="font-semibold">{joinNames(details.dismissedPeople.map((p) => p.name))}</span> {details.dismissedPeople.length === 1 ? 'was' : 'were'} dismissed earlier, so Deep find skipped them.</span>
          </p>
          <ul className="flex flex-col gap-2">
            {details.dismissedPeople.filter((p) => p.contactId).map((p) => <li key={p.contactId}><RestorePersonButton contactId={p.contactId as string} name={p.name} showStatus /></li>)}
          </ul>
          <p className="text-[13px]">Or run Deep find again with Start fresh.</p>
        </section>
      )}
      {details.people.length > 0 && (
        <Section title="People" level={level + 1}>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {details.people.map((p, i) => <li key={`${p.name}:${i}`} className="flex min-w-0 flex-col gap-1.5 rounded-control border border-line bg-raised p-2.5">
              <span className="break-words font-semibold">{p.name}</span>
              {p.role && <span className="break-words text-[13px]">{p.role}</span>}
              <span className="flex flex-wrap gap-1.5">
                {p.source && <span className="rounded-full border border-line bg-raised px-2 py-0.5 text-xs font-semibold">{p.source}</span>}
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${p.email_found ? 'border-green-500/50 bg-green-500/10' : 'border-line bg-raised'}`}>
                  {p.email_found ? <MailCheck size={12} aria-hidden /> : <MailX size={12} aria-hidden />}{p.email_found ? 'Email found' : 'Email not found'}
                </span>
              </span>
            </li>)}
          </ul>
        </Section>
      )}
      {row.lead && details.suggestions.length + toCheck.length > 0 && <DeepFindSuggestions headingLevel={level + 1} key={row.lead_id} leadId={row.lead_id} refreshKey={row.updated_at} roles={[...details.namedByWeb, ...details.namedOnSite]} suggestions={[...details.suggestions, ...toCheck]} />}
      {row.lead && <DeepFindAutoChanges headingLevel={level + 1} key={`${row.id}:${row.updated_at}`} leadId={row.lead_id} changes={details.autoApplied} />}
      <CompanyDomainsEditor headingLevel={level + 1} leadId={row.lead_id} domains={details.domains} />
      {details.steps.length > 0 && (
        <details className="rounded-control border border-line bg-raised p-3">
          <summary className="cursor-pointer font-semibold focus-visible:outline-2 focus-visible:outline-violet-line">What Deep find did ({details.steps.length} {details.steps.length === 1 ? 'step' : 'steps'})</summary>
          <ul className="mt-2 flex list-disc flex-col gap-2 pl-5 text-[13px] leading-relaxed">
            {details.steps.map((s, i) => <li key={i}>{s}{s.startsWith('Web search and role search skipped: Gemini refused the key')&&<> <Link className="text-link underline" to={geminiRefusalHref()}>Fix this key</Link></>}</li>)}
          </ul>
        </details>
      )}
      {row.lead && row.status === 'done' && <QueuedChecksLine leadId={row.lead_id} runId={row.run_id} />}
      </div>}
    </li>
  );
}
