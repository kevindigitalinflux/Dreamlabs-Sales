/** Classify successful access decisions separately from failed database reads. */
export function classifyDeepFindCheckpoint(input: {
  runStatus: unknown; runReadFailed: boolean; canEdit: unknown; accessReadFailed: boolean;
}): 'authorised' | 'authorisation_lost' | 'unavailable' {
  // Either successful check can prove loss, even if the other read failed.
  if ((!input.runReadFailed && input.runStatus !== 'active')
    || (!input.accessReadFailed && input.canEdit !== true)) return 'authorisation_lost';
  if (input.runReadFailed || input.accessReadFailed) return 'unavailable';
  return 'authorised';
}

/** A confirmed loss must escape the optional provider's recoverable failure path. */
export class DeepFindAuthorisationLost extends Error {
  constructor() { super('Deep find is no longer authorised.'); }
}
