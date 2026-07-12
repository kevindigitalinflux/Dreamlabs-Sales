import { useState } from 'react';
import { Button } from '../ui/Button';
import { Input, SelectField } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { StepProgress } from '../ui/StepProgress';
import { PACKAGE_TIERS, STAGES } from '../../lib/utils';
import type { LeadInput } from '../../hooks/useLeads';
import type { PackageTier, Stage } from '../../types';

interface AddLeadWizardProps {
  open: boolean;
  onClose: () => void;
  onCreate: (input: LeadInput) => Promise<string | null>;
}

const EMPTY: LeadInput = { business_name: '' };
const TOTAL_STEPS = 4;

/** 4-step "Add lead" wizard: Company → Contact → Location → Deal. */
export function AddLeadWizard({ open, onClose, onCreate }: AddLeadWizardProps) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<LeadInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof LeadInput>(key: K, value: LeadInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function close() {
    setStep(1);
    setForm(EMPTY);
    setError(null);
    onClose();
  }

  function next() {
    if (step === 1 && !form.business_name.trim()) {
      setError('Business name is required.');
      return;
    }
    setError(null);
    setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    const err = await onCreate(form);
    setSubmitting(false);
    if (err) setError(err);
    else close();
  }

  return (
    <Modal open={open} onClose={close} title="Add lead">
      <div className="flex flex-col gap-5">
        <StepProgress step={step} total={TOTAL_STEPS} />

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <Input label="Business name *" value={form.business_name} onChange={(e) => set('business_name', e.target.value)} required />
            <Input label="Owner name" value={form.owner_name ?? ''} onChange={(e) => set('owner_name', e.target.value || null)} />
            <Input label="Vertical / industry" value={form.vertical ?? ''} onChange={(e) => set('vertical', e.target.value || null)} placeholder="e.g. Commercial cleaning" />
          </div>
        )}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <Input label="Phone" type="tel" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value || null)} />
            <Input label="Email" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value || null)} />
            <Input label="Website" type="url" value={form.website ?? ''} onChange={(e) => set('website', e.target.value || null)} placeholder="https://" />
          </div>
        )}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <Input label="Address" value={form.address ?? ''} onChange={(e) => set('address', e.target.value || null)} />
            <Input label="City" value={form.city ?? ''} onChange={(e) => set('city', e.target.value || null)} />
            <Input label="Postcode" value={form.postcode ?? ''} onChange={(e) => set('postcode', e.target.value || null)} />
          </div>
        )}
        {step === 4 && (
          <div className="flex flex-col gap-4">
            <SelectField label="Stage" value={form.stage ?? 'new_lead'} onChange={(e) => set('stage', e.target.value as Stage)}>
              {STAGES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </SelectField>
            <SelectField label="Package tier" value={form.package_tier ?? ''} onChange={(e) => set('package_tier', (e.target.value || null) as PackageTier | null)}>
              <option value="">Not set</option>
              {PACKAGE_TIERS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </SelectField>
            <Input label="Deal value (£)" type="number" min="0" value={form.deal_value ?? ''} onChange={(e) => set('deal_value', e.target.value === '' ? null : Number(e.target.value))} />
          </div>
        )}

        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => (step === 1 ? close() : setStep(step - 1))}>
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>
          {step < TOTAL_STEPS ? (
            <Button onClick={next}>Next</Button>
          ) : (
            <Button onClick={() => void submit()} disabled={submitting}>
              {submitting ? 'Creating…' : 'Create lead'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
