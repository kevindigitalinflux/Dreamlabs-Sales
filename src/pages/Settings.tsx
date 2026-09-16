import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { Trash2, Upload } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useOrg } from '../hooks/useOrg';
import { initials } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { Input, Textarea } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';

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

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <h2 className="text-[18px] font-bold">Company context</h2>
        <p className="text-sm text-muted">
          What does {orgName} actually do, who do you sell to, what tone should outreach use? This gets
          included in every AI-drafted email and LinkedIn message for this org — without it, drafts won't
          make any claim about what {orgName} does at all, since the AI never invents facts it wasn't given.
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
            <Button onClick={() => void handleSave()} disabled={status === 'saving'}>
              {status === 'saving' ? 'Saving…' : 'Save'}
            </Button>
            {status === 'saved' && <span className="text-sm text-success">Saved ✓</span>}
            {status === 'error' && <span role="alert" className="text-sm text-danger">Could not save — try again.</span>}
          </div>
        )}
      </div>
    </Card>
  );
}

/** Profile settings: display name, avatar. Email SMTP config arrives in cycle 2. */
export function Settings() {
  const { profile, refreshProfile } = useAuth();
  const { currentOrg } = useOrg();
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
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="text-[28px] font-extrabold">Settings</h1>
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
              <Button type="submit" disabled={status === 'saving'}>
                {status === 'saving' ? 'Saving…' : 'Save'}
              </Button>
              {status === 'saved' && <span className="text-sm text-success">Saved ✓</span>}
              {status === 'error' && <span role="alert" className="text-sm text-danger">Could not save — try again.</span>}
            </div>
          </form>
        </div>
      </Card>
      {currentOrg && <CompanyContextCard orgId={currentOrg.id} orgName={currentOrg.name} isOrgAdmin={currentOrg.role === 'admin'} />}
      <Link to="/settings/email" className="block rounded-xl border border-line bg-card p-5 hover:bg-surface/50">
        <h2 className="text-[18px] font-bold">Email sending</h2>
        <p className="text-sm text-muted">Connect your Gmail/Outlook so Dreamlabs Sales can send from your address.</p>
      </Link>
      <Link to="/settings/dialer" className="block rounded-xl border border-line bg-card p-5 hover:bg-surface/50">
        <h2 className="text-[18px] font-bold">Power dialer</h2>
        <p className="text-sm text-muted">Connect your JustCall/Kixie/Aircall account so calls log automatically.</p>
      </Link>
      {currentOrg?.role === 'admin' && (
        <Link to="/settings/organization" className="block rounded-xl border border-line bg-card p-5 hover:bg-surface/50">
          <h2 className="text-[18px] font-bold">Organization API keys</h2>
          <p className="text-sm text-muted">Bring your own Gemini/Places/Companies House keys for {currentOrg.name}.</p>
        </Link>
      )}
    </div>
  );
}
