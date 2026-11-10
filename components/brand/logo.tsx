import { cn } from "@/lib/utils";

export const TAGLINE = "Keeping every child safe and accounted for.";

type Variant = "brand" | "inverse" | "mono";

const COLORS: Record<Variant, { bg: string; t: string; wave: string }> = {
  brand: { bg: "#0F766E", t: "#FFFFFF", wave: "#F59E0B" }, // teal tile, on light backgrounds
  inverse: { bg: "#FFFFFF", t: "#0F766E", wave: "#F59E0B" }, // white tile, on teal backgrounds
  mono: { bg: "#0F172A", t: "#FFFFFF", wave: "#FFFFFF" }, // one colour (print, stamps)
};

/** The raw mark as an SVG string (for favicons and generated icons). */
export function logoSvg(variant: Variant = "brand", size = 48): string {
  const c = COLORS[variant];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="${c.bg}"/><path d="M13.5 14.5h13M20 14.5v19" fill="none" stroke="${c.t}" stroke-width="5" stroke-linecap="round"/><path d="M29.3 21.2a7 7 0 0 1 0 9.6M33.3 17.2a12.4 12.4 0 0 1 0 17.6" fill="none" stroke="${c.wave}" stroke-width="3" stroke-linecap="round"/></svg>`;
}

/** "Signal T" mark: the T of TapIn sending out a tap wave. */
export function Logo({ className, variant = "brand", title = "TapIn" }: { className?: string; variant?: Variant; title?: string }) {
  const c = COLORS[variant];
  return (
    <svg viewBox="0 0 48 48" role="img" aria-label={title} className={cn("shrink-0", className)}>
      <rect width="48" height="48" rx="12" fill={c.bg} />
      <path d="M13.5 14.5h13M20 14.5v19" fill="none" stroke={c.t} strokeWidth="5" strokeLinecap="round" />
      <path d="M29.3 21.2a7 7 0 0 1 0 9.6M33.3 17.2a12.4 12.4 0 0 1 0 17.6" fill="none" stroke={c.wave} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Mark + "TapIn" wordmark. `onDark` uses white + yellow for teal backgrounds. */
export function Wordmark({ className, markClassName, onDark = false }: { className?: string; markClassName?: string; onDark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Logo className={cn("size-9", markClassName)} variant={onDark ? "inverse" : "brand"} title="" />
      <span className="font-heading text-[1.35em] font-bold leading-none tracking-tight" aria-label="TapIn">
        <span className={onDark ? "text-white" : "text-ink"}>Tap</span>
        <span className={onDark ? "text-amber-400" : "text-brand"}>In</span>
      </span>
    </span>
  );
}
