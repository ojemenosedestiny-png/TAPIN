import { cn } from "@/lib/utils";

/**
 * NFC waves: rings that grow out of the centre and fade, one after another, forever. Pure CSS, so it runs
 * smoothly on a cheap tablet. Colour comes from `currentColor`. Hidden from screen readers; still under
 * reduced motion.
 */
export function Ripple({ rings = 4, durationMs = 3600, still = 4, className, ringClassName }: {
  /** Moving waves. */
  rings?: number;
  /** How long one wave takes to travel out. */
  durationMs?: number;
  /** Faint fixed rings behind the waves, like a target. 0 for none. */
  still?: number;
  className?: string;
  ringClassName?: string;
}) {
  return (
    <span aria-hidden className={cn("pointer-events-none absolute inset-0", className)}>
      {Array.from({ length: still }, (_, i) => (
        <span key={`s${i}`} className="ripple-still" style={{ inset: `${(i * 50) / Math.max(still, 1)}%`, opacity: 0.1 + i * 0.03 }} />
      ))}
      {Array.from({ length: rings }, (_, i) => (
        <span key={i} className={cn("ripple-ring", ringClassName)}
          style={{ "--dur": `${durationMs}ms`, "--d": `${(i * durationMs) / rings}ms` } as React.CSSProperties} />
      ))}
    </span>
  );
}
