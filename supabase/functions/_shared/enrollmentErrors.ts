// Import-free helpers for the "one open enrolment per lead" unique index (migration 055).
// The code must also work while the index is absent, so nothing here assumes the index exists.

/** Message shown when a lead already has an active or paused enrolment. */
export const ALREADY_ENROLLED_MESSAGE = 'This lead is already in a sequence';

/** True when a Postgres/PostgREST error is a unique violation (SQLSTATE 23505). */
export function isUniqueViolation(err: { code?: string | null } | null | undefined): boolean {
  return !!err && err.code === '23505';
}

/** Plain-English message for a failed enrolment insert: the friendly text for a unique violation, else the error's own message. */
export function enrollErrorMessage(err: { code?: string | null; message?: string | null }): string {
  return isUniqueViolation(err) ? ALREADY_ENROLLED_MESSAGE : (err.message || 'Could not enrol the lead');
}
