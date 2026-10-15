import { describe, expect, it } from 'vitest';
import { classifyDeepFindCheckpoint } from '../../supabase/functions/_shared/deepFindCheckpoint';

const authorised = { runStatus: 'active', runReadFailed: false, canEdit: true, accessReadFailed: false };

describe('Deep find checkpoint classification', () => {
  it('continues when both checks authorise the lead', () => {
    expect(classifyDeepFindCheckpoint(authorised)).toBe('authorised');
  });
  it.each(['cancelled', 'completed', undefined])('stops for a successfully read inactive/missing run: %s', (runStatus) => {
    expect(classifyDeepFindCheckpoint({ ...authorised, runStatus })).toBe('authorisation_lost');
  });
  it.each([false, null])('stops when edit access is not granted: %s', (canEdit) => {
    expect(classifyDeepFindCheckpoint({ ...authorised, canEdit })).toBe('authorisation_lost');
  });
  it('treats a failed run read as transient rather than a missing run', () => {
    expect(classifyDeepFindCheckpoint({ ...authorised, runStatus: undefined, runReadFailed: true })).toBe('unavailable');
  });
  it('treats a failed edit check as transient rather than denied access', () => {
    expect(classifyDeepFindCheckpoint({ ...authorised, canEdit: null, accessReadFailed: true })).toBe('unavailable');
  });
  it('treats two failed reads as transient', () => {
    expect(classifyDeepFindCheckpoint({ runStatus: undefined, runReadFailed: true, canEdit: null, accessReadFailed: true })).toBe('unavailable');
  });
  it('stops on confirmed cancellation even if the edit check failed', () => {
    expect(classifyDeepFindCheckpoint({ ...authorised, runStatus: 'cancelled', canEdit: null, accessReadFailed: true })).toBe('authorisation_lost');
  });
  it('stops on confirmed access loss even if the run read failed', () => {
    expect(classifyDeepFindCheckpoint({ ...authorised, runStatus: undefined, runReadFailed: true, canEdit: false })).toBe('authorisation_lost');
  });
});
