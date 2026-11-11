import { cn } from "@/lib/utils";
import { Logo, TapInWord } from "./logo";

/**
 * "Powered by TapIn": the small signature on every screen (dashboard, sign-in, kiosk, parent portal, print).
 * The mark's waves pulse and the gold shimmers; both stop for people who turn on reduced motion.
 */
export function PoweredBy({ onDark = false, className }: { onDark?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "powered-by inline-flex select-none items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium tracking-wide ring-1 backdrop-blur-sm",
        onDark ? "bg-white/5 text-white/65 ring-white/15" : "bg-card/70 text-muted-foreground ring-border",
        className,
      )}
    >
      <span>Powered by</span>
      <Logo className="size-4" variant={onDark ? "inverse" : "brand"} title="" animated />
      <TapInWord onDark={onDark} className="text-[12px]" />
    </span>
  );
}
