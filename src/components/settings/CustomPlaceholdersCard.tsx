import { useCustomVariables } from '../../hooks/useCustomVariables';
import { Collapsible } from '../ui/Collapsible';
import { Braces } from 'lucide-react';
import { Skeleton } from '../ui/Skeleton';
import { PlaceholderAddForm } from './PlaceholderAddForm';
import { PlaceholderRow } from './PlaceholderRow';

/**
 * Settings section for custom email placeholders, e.g. {{google_meet_link}}. They appear as
 * buttons in the template editor and are filled in when an email is drafted or a sequence
 * step is written. "Your placeholders" are filled from YOUR own value (everyone has their
 * own meeting link); "Company-wide" ones are shared, set by an org admin, and used when the
 * sender has no personal value of the same name.
 */
export function CustomPlaceholdersCard({ isOrgAdmin }: { isOrgAdmin: boolean }) {
  const { personal, companyWide, loading, error, add, update, remove } = useCustomVariables();

  return (
    <Collapsible icon={Braces} title="Custom placeholders" summary={loading ? 'Loading' : `${personal.length + companyWide.length} set`}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Make your own <code>{'{{placeholders}}'}</code> for things the built-in ones don't cover, like your Google Meet link
          or your booking page. Use one in any email template or sequence; each email gets the sender's own value.
        </p>
        {loading && <Skeleton className="h-24 w-full" />}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-bold">Your placeholders</h3>
          <p className="text-xs text-muted">Only you can see and use these values; emails you send are filled from them.</p>
          {personal.length > 0 && (
            <ul className="flex flex-col gap-2">
              {personal.map((v) => <PlaceholderRow key={v.id} variable={v} canEdit onUpdate={update} onDelete={remove} />)}
            </ul>
          )}
          <PlaceholderAddForm scope="me" onAdd={add} />
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-bold">Company-wide placeholders</h3>
          <p className="text-xs text-muted">
            Shared by everyone, for things like the company phone number. Used whenever the sender hasn't set their own placeholder with the same name.
            {!isOrgAdmin && ' Only an org admin can add or change these.'}
          </p>
          {companyWide.length === 0 && !isOrgAdmin && <p className="text-xs text-muted">None yet.</p>}
          {companyWide.length > 0 && (
            <ul className="flex flex-col gap-2">
              {companyWide.map((v) => <PlaceholderRow key={v.id} variable={v} canEdit={isOrgAdmin} onUpdate={update} onDelete={remove} />)}
            </ul>
          )}
          {isOrgAdmin && <PlaceholderAddForm scope="company" onAdd={add} />}
        </section>
      </div>
    </Collapsible>
  );
}
