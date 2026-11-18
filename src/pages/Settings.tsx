import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { Building2, ChevronRight, Gauge, KeyRound, Mail, PackageOpen, Phone, Trash2, Upload, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useOrg } from '../hooks/useOrg';
import { initials } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { Input, Textarea } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Collapsible } from '../components/ui/Collapsible';
import { Skeleton } from '../components/ui/Skeleton';
import { CompanyProfileCard } from '../components/settings/CompanyProfileCard';
import { IdealCustomerProfilesCard } from '../components/settings/IdealCustomerProfilesCard';
import { CustomPlaceholdersCard } from '../components/settings/CustomPlaceholdersCard';
import { UsageLimitsCard } from '../components/settings/UsageLimitsCard';
import { DesktopNotificationsCard } from '../components/settings/DesktopNotificationsCard';
import { SetupSkillCard } from '../components/settings/SetupSkillCard';
import { MailboxStatus } from '../components/settings/MailboxStatus';

/** A link to a settings sub-page, styled like the folding groups above it so the page reads as one set of floating sections. */
function ConnectionLink({ to, icon: Icon, title, hint }: { to: string; icon: LucideIcon; title: string; hint: string }) {
  return (
    <Link to={to} className="flex min-h-14 items-center gap-3 rounded-surface border border-line bg-raised px-4 py-3 shadow-raised hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-nested bg-violet-soft text-link"><Icon className="h-4 w-4" aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-heading text-[15px] font-semibold">{title}</span>
        <span className="block text-sm text-muted">{hint}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
    </Link>
  );
}

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/**
 * Free-text "who we are" context injected into every AI-drafted email/LinkedIn
 * message for this org — without it, drafting prompts fall back to a neutral
 * line with no industry claim, matching the guardrail of never inventing facts.
 * Visible to every rep in the org (useful to know what the AI's been told),
 * but only an admin can edit — RLS (organizations_admin_update_context) is the
 * real gate, this just avoids offering a control that would fail on submit.
 */
function CompanyContextCard({ orgId, orgName, isOrgAdmin }: { orgId: string; orgName: string; isOrgAdmin: boolean }) {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void supabase.from('organizations').select('company_context').eq('id', orgId).maybeSingle().then(({ data }) => {
      if (cancelled) return;
      setValue((data as { company_context: string | null } | null)?.company_context ?? '');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [orgId]);

  async function handleSave() {
    setStatus('saving');
    const { error } = await supabase.from('organizations').update({ company_context: value.trim() || null }).eq('id', orgId);
    setStatus(error ? 'error' : 'saved');
  }

  if (loading) return <Skeleton className="h-48 w-full max-w-xl" />;

  const firstLine = value.trim().split(/\r?\n/)[0] ?? '';
  return (
    <Collapsible icon={Building2} title="Company context" summary={firstLine ? firstLine.slice(0, 80) : 'Not written yet'}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          Tell the AI what {orgName} does, who you sell to and what tone to use. It goes into every AI-drafted email and
          LinkedIn message. Without it, drafts make no claim about what {orgName} does, because the AI never invents facts.
        </p>
        <Textarea
          label="About your company"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={6}
          disabled={!isOrgAdmin}
          placeholder="e.g. We're a commercial cleaning company serving offices and retail units across London. We focus on flexible contracts and same-week onboarding. Keep outreach friendly and practical, not corporate."
        />
        {!isOrgAdmin && <p className="text-xs text-muted">Only an org admin can edit this.</p>}
        {isOrgAdmin && (
          <div className="flex items-center gap-3">
            <Button onClick={() => void handleSave()} disabled={status === 'saving'} loading={status === 'saving'}>
              {status === 'saving' ? 'Saving…' : 'Save'}
            </Button>
            {status === 'saved' && <span className="text-sm text-success">Saved ✓</span>}
            {status === 'error' && <span role="alert" className="text-sm text-danger">Could not save — try again.</span>}
          </div>
        )}
      </div>
    </Collapsible>
  );
}

/** Profile settings: display name, avatar. Email SMTP config arrives in cycle 2. */
export function Settings() {
  const { profile, refreshProfile } = useAuth();
  const { currentOrg } = useOrg();
  const [importRevision, setImportRevision] = useState(0);
  const [fullName, setFullName] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [avatarStatus, setAvatarStatus] = useState<'idle' | 'uploading' | 'error'>('idle');
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFullName(profile?.full_name ?? '');
  }, [profile]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setStatus('saving');
    const { error } = await supabase.from('profiles').update({ full_name: fullName }).eq('id', profile.id);
    setStatus(error ? 'error' : 'saved');
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !profile) return;
    if (!file.type.startsWith('image/')) { setAvatarStatus('error'); setAvatarError('Choose an image file.'); return; }
    if (file.size > MAX_AVATAR_BYTES) { setAvatarStatus('error'); setAvatarError('Image must be under 5MB.'); return; }

    setAvatarStatus('uploading');
    setAvatarError(null);
    const ext = file.name.split('.').pop() ?? 'jpg';
    const path = `${profile.id}/avatar.${ext}`;
    const { error: uploadErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
    if (uploadErr) { setAvatarStatus('error'); setAvatarError(uploadErr.message); return; }

    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
    const url = `${urlData.publicUrl}?t=${Date.now()}`;
    const { error: updateErr } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', profile.id);
    if (updateErr) { setAvatarStatus('error'); setAvatarError(updateErr.message); return; }

    await refreshProfile();
    setAvatarStatus('idle');
  }

  async function handleAvatarRemove() {
    if (!profile) return;
    setAvatarStatus('uploading');
    const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', profile.id);
    if (error) { setAvatarStatus('error'); setAvatarError(error.message); return; }
    await refreshProfile();
    setAvatarStatus('idle');
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <h1 className="mb-3 text-[28px] font-bold">Settings</h1>
      <Collapsible icon={UserRound} title="Your account" summary={profile?.full_name ?? profile?.email ?? 'Profile and notifications'} defaultOpen>
      <div className="flex flex-col gap-4">
      <DesktopNotificationsCard />
      <MailboxStatus warningOnly />
      <Card>
        <div className="flex flex-col gap-4">
          <h2 className="text-[18px] font-bold">Profile</h2>
          <div className="flex items-center gap-4">
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-purple text-lg font-bold text-on-accent">
                {initials(profile?.full_name)}
              </span>
            )}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => void handleAvatarChange(e)} className="hidden" />
                <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={avatarStatus === 'uploading'}>
                  <Upload className="h-4 w-4" aria-hidden />
                  {avatarStatus === 'uploading' ? 'Uploading…' : 'Upload photo'}
                </Button>
                {profile?.avatar_url && (
                  <Button type="button" variant="ghost" onClick={() => void handleAvatarRemove()} disabled={avatarStatus === 'uploading'}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                    Remove
                  </Button>
                )}
              </div>
              {avatarStatus === 'error' && <span role="alert" className="text-sm text-danger">{avatarError}</span>}
            </div>
          </div>
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={status === 'saving'} loading={status === 'saving'}>
                {status === 'saving' ? 'Saving…' : 'Save'}
              </Button>
              {status === 'saved' && <span className="text-sm text-success">Saved ✓</span>}
              {status === 'error' && <span role="alert" className="text-sm text-danger">Could not save — try again.</span>}
            </div>
          </form>
        </div>
      </Card>
      </div>
      </Collapsible>
      {currentOrg && (
        <Collapsible icon={PackageOpen} title="Setup skill" summary="Download and import your setup">
          <SetupSkillCard isAdmin={currentOrg.role === 'admin'} onApplied={() => setImportRevision((v) => v + 1)} />
        </Collapsible>
      )}
      {currentOrg && <CompanyContextCard key={`context-${importRevision}`} orgId={currentOrg.id} orgName={currentOrg.name} isOrgAdmin={currentOrg.role === 'admin'} />}
      {currentOrg && <IdealCustomerProfilesCard key={`icps-${importRevision}`} isOrgAdmin={currentOrg.role === 'admin'} />}
      <CompanyProfileCard />
      {currentOrg && <CustomPlaceholdersCard isOrgAdmin={currentOrg.role === 'admin'} />}
      {currentOrg && (
        <Collapsible icon={Gauge} title="Usage limits" summary="Daily allowances for the lookup worker">
          <UsageLimitsCard orgId={currentOrg.id} isOrgAdmin={currentOrg.role === 'admin'} />
        </Collapsible>
      )}
      <ConnectionLink to="/settings/email" icon={Mail} title="Email sending" hint="Connect your Gmail or Outlook so Dreamlabs Sales can send from your address." />
      <ConnectionLink to="/settings/dialer" icon={Phone} title="Power dialer" hint="Connect your JustCall, Kixie or Aircall account so calls log automatically." />
      {currentOrg?.role === 'admin' && (
        <ConnectionLink to="/settings/organization" icon={KeyRound} title="Organization API keys" hint={`Bring your own Gemini, Places and Companies House keys for ${currentOrg.name}.`} />
      )}
    </div>
  );
}
