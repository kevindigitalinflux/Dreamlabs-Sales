import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { OrgMembership, Role } from '../types';

interface OrgContextValue {
  currentOrg: OrgMembership | null;
  orgs: OrgMembership[];
  loading: boolean;
  switchOrg: (orgId: string) => void;
  /** Updates an org's cached custom package list after a successful save. */
  setOrgPackages: (orgId: string, packages: string[] | null) => void;
}

const OrgContext = createContext<OrgContextValue | null>(null);

interface MembershipRow {
  role: Role;
  organizations: { id: string; name: string; custom_packages: string[] | null };
}

/** Provides the signed-in user's org memberships and the currently-selected org. */
export function OrgProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [orgs, setOrgs] = useState<OrgMembership[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) {
      setOrgs([]);
      setCurrentOrgId(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void supabase
      .from('org_members')
      .select('role, organizations(id, name, custom_packages)')
      .eq('user_id', session.user.id)
      .then(({ data }) => {
        if (cancelled) return;
        const rows = (data as MembershipRow[] | null) ?? [];
        const memberships = rows.map((r) => ({ id: r.organizations.id, name: r.organizations.name, role: r.role, custom_packages: r.organizations.custom_packages }));
        setOrgs(memberships);
        const saved = localStorage.getItem('current-org');
        const restored = memberships.find((m) => m.id === saved);
        setCurrentOrgId((restored ?? memberships[0])?.id ?? null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const switchOrg = useCallback((orgId: string) => {
    localStorage.setItem('current-org', orgId);
    setCurrentOrgId(orgId);
  }, []);

  const setOrgPackages = useCallback((orgId: string, packages: string[] | null) => {
    setOrgs((prev) => prev.map((o) => (o.id === orgId ? { ...o, custom_packages: packages } : o)));
  }, []);

  const currentOrg = orgs.find((o) => o.id === currentOrgId) ?? null;

  return (
    <OrgContext.Provider value={{ currentOrg, orgs, loading, switchOrg, setOrgPackages }}>
      {children}
    </OrgContext.Provider>
  );
}

/** Access the current org context; must be used inside OrgProvider. */
export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used inside OrgProvider');
  return ctx;
}
