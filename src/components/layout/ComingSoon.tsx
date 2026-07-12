import { Hourglass } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';

/** Placeholder page for modules that arrive in later build cycles. */
export function ComingSoon({ module }: { module: string }) {
  return (
    <div className="mx-auto max-w-2xl pt-16">
      <EmptyState
        icon={Hourglass}
        title={`${module} is coming soon`}
        hint="This module arrives in a later build cycle. The database is already ready for it."
      />
    </div>
  );
}
