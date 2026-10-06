import { groupByCategory } from '../../lib/categories';

/**
 * The <option>/<optgroup> children for a template or sequence picker, grouped under a
 * heading per category (A to Z, items by name) with uncategorised ones last. When nothing
 * has a category yet it is just a plain flat list, with no heading to add noise. Returned
 * as an array so it can be dropped straight into a SelectField/Listbox, which already
 * understands optgroups.
 *
 * `uncategorisedLabel` heads the uncategorised group when there ARE categories; pass the
 * same `showGroupInValue` to the SelectField so a chosen item still shows its category in
 * the closed box.
 */
export function categorisedOptions<T extends { name: string; category?: string | null }>(
  items: T[],
  toOption: (item: T) => { value: string; label?: string },
  uncategorisedLabel = 'Uncategorised',
): React.ReactNode[] {
  const groups = groupByCategory(items);
  const option = (item: T) => {
    const o = toOption(item);
    return <option key={o.value} value={o.value}>{o.label ?? item.name}</option>;
  };
  // Nothing categorised: a flat list reads better than a single "Uncategorised" heading.
  if (groups.length === 1 && groups[0]!.label === null) return groups[0]!.items.map(option);
  return groups.map((g) => (
    <optgroup key={g.label ?? '__uncategorised'} label={g.label ?? uncategorisedLabel}>
      {g.items.map(option)}
    </optgroup>
  ));
}
