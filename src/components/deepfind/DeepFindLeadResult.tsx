import { AlertTriangle, CheckCircle2, CircleSlash, Clock, Loader2, MailCheck, MailX, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { DEEP_FIND_STATUS_LABELS, readDeepFindDetails } from '../../lib/deepFindView';
import type { DeepFindRowWithLead } from '../../hooks/useDeepFindRun';
import { DeepFindCompanyChoice } from './DeepFindCompanyChoice';
import { CompanyDomainsEditor } from './CompanyDomainsEditor';
import { DeepFindSuggestions } from './DeepFindSuggestions';
import { registrySkipReason } from '../../../supabase/functions/_shared/deepFindSuggestions';
import { DeepFindAutoChanges } from './DeepFindAutoChanges';
import { Heading } from './Heading';

const STATUS_ICONS: Record<DeepFindRowWithLead['status'], ReactNode> = {
  queued: <Clock size={14} aria-hidden />,
  running: <Loader2 size={14} aria-hidden className="animate-spin motion-reduce:animate-none" />,
  done: <CheckCircle2 size={14} aria-hidden />,
  failed: <XCircle size={14} aria-hidden />,
  skipped: <CircleSlash size={14} aria-hidden />,
};

const STATUS_CLASSES: Record<DeepFindRowWithLead['status'], string> = {
  queued: 'border-line bg-surface',
  running: 'border-cyan/60 bg-cyan/10',
  done: 'border-green-500/50 bg-green-500/10',
  failed: 'border-red-500/50 bg-red-500/10',
  skipped: 'border-line bg-surface',
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
  const details = readDeepFindDetails(row.domains);
  // Only the officer step waits for this choice; everything else already ran (the row is done).
  const registrySkipped = registrySkipReason(row.lead ?? {});
  const openChoice = details.companyCandidates.length > 0 && !row.lead?.company_number && !registrySkipped;
  const toCheck = [...details.unverified, ...details.namedByWeb, ...details.namedOnSite];
  return (
    <li className="flex min-w-0 flex-col gap-4 rounded-xl border border-line bg-card p-4 text-sm text-offwhite">
      <div className="flex flex-wrap items-center gap-2">
        <Heading level={level} className="min-w-0 flex-1 break-words font-heading text-base font-bold">{row.lead?.business_name ?? 'A lead you cannot see'}</Heading>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[row.status]}`}>{STATUS_ICONS[row.status]}{DEEP_FIND_STATUS_LABELS[row.status]}</span>
        {row.status === 'done' && (
          <span className="inline-flex items-center rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-semibold">{row.people_found === 1 ? '1 person added' : `${row.people_found} people added`}</span>
        )}
      </div>
      {row.reason && <p>{row.reason}</p>}
      {openChoice && (
        <section className="flex flex-col gap-2 rounded-xl border-2 border-violet-line bg-violet/10 p-3.5">
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
        <p role="status" className="flex items-start gap-2 rounded-xl border-2 border-amber-500/60 bg-amber-500/10 p-3">
          <AlertTriangle size={18} aria-hidden className="mt-0.5 shrink-0" />
          <span><span className="font-semibold">Check the website: </span>This website may belong to a different company. {details.websiteReasons.join(' ')}</span>
        </p>
      )}
      {details.people.length > 0 && (
        <Section title="People" level={level + 1}>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {details.people.map((p, i) => <li key={`${p.name}:${i}`} className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-line bg-surface/50 p-2.5">
              <span className="break-words font-semibold">{p.name}</span>
              {p.role && <span className="break-words text-[13px]">{p.role}</span>}
              <span className="flex flex-wrap gap-1.5">
                {p.source && <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-semibold">{p.source}</span>}
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${p.email_found ? 'border-green-500/50 bg-green-500/10' : 'border-line bg-surface'}`}>
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
        <details className="rounded-lg border border-line bg-surface/50 p-3">
          <summary className="cursor-pointer font-semibold focus-visible:outline-2 focus-visible:outline-violet-line">What Deep find did ({details.steps.length} {details.steps.length === 1 ? 'step' : 'steps'})</summary>
          <ul className="mt-2 flex list-disc flex-col gap-2 pl-5 text-[13px] leading-relaxed">
            {details.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </details>
      )}
    </li>
  );
}
