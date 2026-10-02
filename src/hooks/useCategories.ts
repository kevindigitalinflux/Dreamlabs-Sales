import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { distinctCategories } from '../lib/categories';
import { useOrg } from './useOrg';

/**
 * Every category already used by this org's email templates and sequences (they share one
 * vocabulary), for the editors' type-ahead suggestions so "Property managers" doesn't
 * drift into near-duplicates. Fetched once per mount; empty until loaded.
 */
export function useCategories(): string[] {
  const { currentOrg } = useOrg();
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    if (!currentOrg) { setCategories([]); return; }
    let cancelled = false;
    const scope = `org_id.is.null,org_id.eq.${currentOrg.id}`;
    void Promise.all([
      supabase.from('email_templates').select('category').or(scope).not('category', 'is', null),
      supabase.from('email_sequences').select('category').or(scope).not('category', 'is', null),
    ]).then(([templates, sequences]) => {
      if (cancelled) return;
      setCategories(distinctCategories([...(templates.data ?? []), ...(sequences.data ?? [])] as { category: string | null }[]));
    });
    return () => { cancelled = true; };
  }, [currentOrg]);

  return categories;
}
