import { useId } from 'react';
import { Tag } from 'lucide-react';
import { UNCATEGORISED } from '../../lib/categories';
import { Input, SelectField } from '../ui/Input';

/**
 * Category input with type-ahead from the categories already in use, so the same name gets
 * reused rather than re-typed slightly differently. Free text: a new name simply creates it.
 */
export function CategoryField({ value, onChange, suggestions }: { value: string; onChange: (value: string) => void; suggestions: string[] }) {
  const listId = useId();
  return (
    <>
      <Input
        label="Category (optional)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={listId}
        maxLength={60}
        placeholder="e.g. Property managers"
      />
      <datalist id={listId}>
        {suggestions.map((s) => <option key={s} value={s} />)}
      </datalist>
    </>
  );
}

/** Filter above a list of templates or sequences. Renders nothing until at least one category exists. */
export function CategoryFilter({ value, onChange, categories, hasUncategorised }: {
  value: string;
  onChange: (value: string) => void;
  categories: string[];
  hasUncategorised: boolean;
}) {
  if (categories.length === 0) return null;
  return (
    <div className="w-full max-w-xs">
      <SelectField label="Category" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All categories</option>
        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        {hasUncategorised && <option value={UNCATEGORISED}>Uncategorised</option>}
      </SelectField>
    </div>
  );
}

/** The small category tag shown on a template/sequence card. */
export function CategoryBadge({ category }: { category: string | null | undefined }) {
  if (!category) return null;
  return (
    <span className="flex items-center gap-1 rounded-full bg-violet/20 px-2 py-0.5 text-[11px] font-semibold text-offwhite">
      <Tag className="h-3 w-3" aria-hidden /> {category}
    </span>
  );
}
