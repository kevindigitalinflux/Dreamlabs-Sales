/** A review flag must never claim a lead was updated when RLS refused the write. */
export async function saveLookupProposal(writeLead: () => Promise<string | null>, markApplied: () => Promise<boolean>): Promise<string | null> {
  const error = await writeLead();
  if (error) return error;
  return await markApplied() ? null : 'The lead was saved, but the review could not be marked applied. Refresh and try again.';
}
