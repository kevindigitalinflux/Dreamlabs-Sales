/** Which tab gets focus after a key press in a tab strip: arrows wrap around, Home and End jump, anything else stays. */
export function nextTabIndex(current: number, key: string, count: number): number {
  if (count <= 0) return 0;
  if (key === 'ArrowRight') return (current + 1) % count;
  if (key === 'ArrowLeft') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return current;
}
