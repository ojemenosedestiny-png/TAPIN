import { cn } from "@/lib/utils";

/** Rounded card with a signal arc that forms a check mark. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" role="img" aria-label="TapIn" className={cn("text-brand", className)}>
      <rect x="4" y="9" width="40" height="30" rx="7" fill="currentColor" />
      <path d="M15 24.5l5.5 5.5L33 17.5" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M33 10.5a10 10 0 0 1 7 7" fill="none" stroke="#F59E0B" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
