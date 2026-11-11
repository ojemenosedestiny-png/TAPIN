import Link from "next/link";
import { Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FEATURE_LABEL, type Feature } from "@/lib/plans";

/** Shown in place of a Premium feature on a Basic school. */
export function UpgradePrompt({ feature, points }: { feature: Feature; points: string[] }) {
  return (
    <section className="surface mx-auto max-w-2xl overflow-hidden rounded-2xl" aria-labelledby="upgrade-h">
      <div className="bg-gradient-to-br from-brand-dark via-brand to-[#0d9488] px-6 py-8 text-white sm:px-8">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider ring-1 ring-white/25">
          <Lock className="size-3.5" aria-hidden /> Premium
        </span>
        <h2 id="upgrade-h" className="mt-4 font-heading text-2xl font-semibold sm:text-3xl">Upgrade to Premium</h2>
        <p className="mt-2 text-white/85">{FEATURE_LABEL[feature]} is part of TapIn Premium.</p>
      </div>
      <div className="px-6 py-6 sm:px-8">
        <ul className="space-y-2.5">
          {points.map((p) => (
            <li key={p} className="flex gap-3 text-sm text-ink"><Sparkles className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />{p}</li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button asChild><Link href="/pricing">See plans</Link></Button>
          <Button asChild variant="outline"><Link href="/invoices">Billing</Link></Button>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">Already upgraded? Ask TapIn to switch your school to Premium; it takes effect straight away.</p>
      </div>
    </section>
  );
}

export function PremiumBadge() {
  return <span className="ml-auto rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">Premium</span>;
}
