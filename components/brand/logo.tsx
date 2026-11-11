import { cn } from "@/lib/utils";

export const TAGLINE = "Keeping every child safe and accounted for.";

type Variant = "brand" | "inverse" | "mono";

/** TapIn gold: the waves in the mark and the "In" of the wordmark. */
export const GOLD = "#E8A317";

const COLORS: Record<Variant, { bg: string; t: string; wave: string }> = {
  brand: { bg: "#0F766E", t: "#FFFFFF", wave: GOLD }, // teal tile, on light backgrounds
  inverse: { bg: "#FFFFFF", t: "#0F766E", wave: GOLD }, // white tile, on teal backgrounds
  mono: { bg: "#0F172A", t: "#FFFFFF", wave: "#FFFFFF" }, // one colour (print, stamps)
};

/** The raw mark as an SVG string (for favicons and generated icons). */
export function logoSvg(variant: Variant = "brand", size = 48): string {
  const c = COLORS[variant];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="${c.bg}"/><path d="M13.5 14.5h13M20 14.5v19" fill="none" stroke="${c.t}" stroke-width="5" stroke-linecap="round"/><path d="M29.3 21.2a7 7 0 0 1 0 9.6M33.3 17.2a12.4 12.4 0 0 1 0 17.6" fill="none" stroke="${c.wave}" stroke-width="3" stroke-linecap="round"/></svg>`;
}

/** "Signal T" mark: the T of TapIn sending out a tap wave. `animated` makes the waves pulse out, one after the other. */
export function Logo({ className, variant = "brand", title = "TapIn", animated = false }: { className?: string; variant?: Variant; title?: string; animated?: boolean }) {
  const c = COLORS[variant];
  return (
    <svg viewBox="0 0 48 48" role="img" aria-label={title || undefined} aria-hidden={title ? undefined : true} className={cn("shrink-0", className)}>
      <rect width="48" height="48" rx="12" fill={c.bg} />
      <path d="M13.5 14.5h13M20 14.5v19" fill="none" stroke={c.t} strokeWidth="5" strokeLinecap="round" />
      <path d="M29.3 21.2a7 7 0 0 1 0 9.6" fill="none" stroke={c.wave} strokeWidth="3" strokeLinecap="round" className={cn(animated && "logo-wave")} />
      <path d="M33.3 17.2a12.4 12.4 0 0 1 0 17.6" fill="none" stroke={c.wave} strokeWidth="3" strokeLinecap="round" className={cn(animated && "logo-wave logo-wave-2")} />
    </svg>
  );
}

/** The word "TapIn": "Tap" in the text colour, "In" in shimmering gold. */
export function TapInWord({ onDark = false, className }: { onDark?: boolean; className?: string }) {
  return (
    <span className={cn("font-heading font-bold tracking-tight", className)} aria-label="TapIn">
      <span aria-hidden className={onDark ? "text-white" : "text-ink"}>Tap</span>
      <span aria-hidden className={cn("tapin-gold", onDark && "gold-bright")}>In</span>
    </span>
  );
}

/** Mark + "TapIn" wordmark. `onDark` for teal or dark backgrounds. */
export function Wordmark({ className, markClassName, onDark = false, animated = true }: { className?: string; markClassName?: string; onDark?: boolean; animated?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Logo className={cn("size-9", markClassName)} variant={onDark ? "inverse" : "brand"} title="" animated={animated} />
      <TapInWord onDark={onDark} className="text-[1.35em] leading-none" />
    </span>
  );
}
