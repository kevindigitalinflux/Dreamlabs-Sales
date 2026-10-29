/** Limits beyond which a note is shown shortened with a "Show full note" toggle. */
export const NOTE_LIMITS = {
  compact: { lines: 3, chars: 240 },
  full: { lines: 6, chars: 600 },
} as const;

/** True when a note is long enough to be shortened to its first lines by default. */
export function isLongNote(content: string, compact: boolean): boolean {
  const limit = compact ? NOTE_LIMITS.compact : NOTE_LIMITS.full;
  return content.length > limit.chars || content.split('\n').length > limit.lines;
}
