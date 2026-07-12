/** Shimmer placeholder block — the app's only loading indicator (no spinners). */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`rounded-md bg-surface motion-safe:animate-pulse ${className}`} />;
}
