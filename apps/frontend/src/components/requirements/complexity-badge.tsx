import { Badge } from '@/components/ui/badge';
import { getComplexityConfig } from '@/lib/semantic/complexity';
import { cn } from '@/lib/utils';

/** The four sizes, smallest first: the meter fills one bar per step. */
const STEPS = ['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'] as const;

/**
 * How big a requirement is — not how urgent.
 *
 * Complexity was drawn in priority's semantic colours (amber for High, red for
 * Very High), so the requirements table showed two identical "High" pills side
 * by side and a large but unhurried requirement read as an urgent one. A
 * neutral outline with a size meter says "size" at a glance and leaves colour
 * to priority, which is the one that means "act on this".
 */
export function ComplexityBadge({
  complexity,
  showName = false,
  className,
}: {
  complexity: string | null | undefined;
  /** Prefix the label with "Complexity", where nothing around it says so. */
  showName?: boolean;
  className?: string;
}) {
  const { label } = getComplexityConfig(complexity);
  const step = STEPS.indexOf(String(complexity ?? '').toUpperCase() as (typeof STEPS)[number]);
  // An unknown value reads as Medium, the way getComplexityConfig reads it.
  const filled = (step === -1 ? 1 : step) + 1;
  return (
    <Badge
      variant="outline"
      className={cn('gap-1.5 font-normal text-muted-foreground', className)}
      title={`Complexity: ${label}`}
    >
      <span aria-hidden="true" className="flex items-end gap-px">
        {STEPS.map((size, i) => (
          <span
            key={size}
            className={cn(
              'w-[3px] rounded-[1px]',
              i < filled ? 'bg-foreground/70' : 'bg-muted-foreground/25'
            )}
            style={{ height: `${5 + i * 2}px` }}
          />
        ))}
      </span>
      <span className="text-foreground">
        {showName ? `Complexity: ${label}` : label}
      </span>
    </Badge>
  );
}
