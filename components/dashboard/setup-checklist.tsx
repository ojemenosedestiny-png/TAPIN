import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { setupSummary, type SetupStep } from "@/lib/setup";

/** The full getting-started list: each step with why it matters, live progress and one action. */
export function SetupChecklist({ steps, schoolName }: { steps: SetupStep[]; schoolName: string }) {
  const s = setupSummary(steps);
  return (
    <section className="motion-rise surface overflow-hidden rounded-2xl" aria-labelledby="setup-h">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border p-6">
        <div>
          <h2 id="setup-h" className="text-xl font-semibold text-ink">
            {s.ready ? `${schoolName} is ready for the gate` : `Get ${schoolName} ready for the gate`}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {s.ready ? "Everything needed for the first morning is done. The optional steps can follow any time." : "Each step ticks itself off as you finish it."}
          </p>
        </div>
        <p className="text-sm tabular-nums text-muted-foreground"><span className="font-heading text-2xl font-semibold text-ink">{s.done}</span> of {s.total} done</p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-brand-light" role="progressbar" aria-valuenow={s.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress">
          <div className="motion-grow-x h-full rounded-full bg-brand" style={{ width: `${s.pct}%` }} />
        </div>
      </div>
      <ol className="divide-y divide-border">
        {steps.map((st, i) => {
          const isNext = s.next?.id === st.id;
          const pct = st.progress ? Math.round((Math.min(st.progress.done, st.progress.of) / st.progress.of) * 100) : null;
          return (
            <li key={st.id} className={cn("motion-rise flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-4", isNext && "bg-accent")} style={{ "--d": `${80 + i * 50}ms` } as React.CSSProperties}>
              <span aria-hidden className={cn("flex size-7 shrink-0 items-center justify-center rounded-full",
                st.done ? "bg-success text-white" : isNext ? "bg-brand text-primary-foreground" : "bg-muted text-muted-foreground")}>
                {st.done ? <Check className="size-4" /> : <span className="text-xs font-semibold tabular-nums">{i + 1}</span>}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn("font-medium", st.done ? "text-muted-foreground" : "text-ink")}>
                  {st.title}
                  {st.optional && <span className="ml-2 text-xs font-normal text-muted-foreground">Optional</span>}
                  <span className="sr-only">{st.done ? " (done)" : " (to do)"}</span>
                </p>
                {!st.done && <p className="mt-0.5 text-sm text-muted-foreground">{st.why}</p>}
                {st.progress && (
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div className={cn("h-full rounded-full", st.done ? "bg-success" : "bg-brand")} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">{st.progress.done.toLocaleString()} of {st.progress.of.toLocaleString()}</span>
                  </div>
                )}
              </div>
              {!st.done && (
                <Link href={st.href} className={cn("motion-press group inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium",
                  isNext ? "bg-primary text-primary-foreground hover:bg-primary/90" : "text-brand hover:bg-muted")}>
                  {st.action}<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** One line on Today while setup isn't finished. */
export function SetupBanner({ steps }: { steps: SetupStep[] }) {
  const s = setupSummary(steps);
  if (s.ready) return null;
  return (
    <Link href="/setup" className="motion-rise motion-press surface mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-5 py-4 hover:border-brand/40">
      <span className="font-medium text-ink">Getting started: {s.done} of {s.total} done</span>
      <span className="h-1.5 w-32 overflow-hidden rounded-full bg-brand-light" aria-hidden><span className="block h-full rounded-full bg-brand" style={{ width: `${s.pct}%` }} /></span>
      {s.next && <span className="text-sm text-muted-foreground">Next: {s.next.title}</span>}
      <ArrowRight className="ml-auto size-4 text-brand" aria-hidden />
    </Link>
  );
}
