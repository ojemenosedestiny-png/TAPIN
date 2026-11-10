import Link from "next/link";
import { cn } from "@/lib/utils";
import { niceTicks, xLabelEvery, type ArrivalBucket } from "@/lib/today";
import { AnimatedNumber } from "./animated-number";
import { PersonAvatar } from "./person-avatar";
import { StatusPill, type PillTone } from "./status-pill";
import { CreditCard } from "lucide-react";

/* ---------------------------------------------------------------- KPI strip */

export type Kpi = { label: string; value: number; of?: number; suffix?: string; caption: string; tone?: "negative" | "warn"; lead?: boolean };

/** One container split by 1px dividers; the lead figure answers the screen's question. */
export function KpiStrip({ items }: { items: Kpi[] }) {
  return (
    <div className={cn("grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card", items.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
      {items.map((k, i) => (
        <div key={k.label} className={cn("motion-rise border-border p-5", i % 2 === 1 && "border-l", i >= 2 && "border-t lg:border-t-0", i > 0 && "lg:border-l",
          // An odd count on a phone: the last cell takes the full row instead of leaving half of it empty.
          items.length % 2 === 1 && i === items.length - 1 && "col-span-2 lg:col-span-1")} style={{ "--d": `${i * 70}ms` } as React.CSSProperties}>
          <p className="text-sm text-muted-foreground">{k.label}</p>
          <p className={cn("mt-1 font-heading font-semibold tracking-tight text-ink", k.lead ? "text-[32px] leading-10" : "text-2xl leading-8",
            k.tone === "negative" && k.value > 0 && "text-red-700", k.tone === "warn" && k.value > 0 && "text-amber-700")}>
            <AnimatedNumber value={k.value} />
            {k.suffix && <span>{k.suffix}</span>}
            {k.of !== undefined && <span className="ml-1 text-base font-normal text-muted-foreground">of {k.of.toLocaleString()}</span>}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{k.caption}</p>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------- The morning gate chart */

/** Arrivals per slot; the resumption line splits on-time (teal) from late (amber). */
export function ArrivalsChart({ buckets, resumption, total }: { buckets: ArrivalBucket[]; resumption: string; total: number }) {
  const max = Math.max(0, ...buckets.map((b) => b.count));
  const ticks = niceTicks(max);
  const top = ticks.at(-1)!;
  const every = xLabelEvery(buckets.length);
  const lateFrom = buckets.findIndex((b) => b.late);
  const late = buckets.filter((b) => b.late).reduce((a, b) => a + b.count, 0);

  return (
    <figure>
      <div className="flex gap-3 pt-4">
        {/* y axis */}
        <div className="relative h-52 w-7 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ bottom: `${(t / top) * 100}%` }}>{t}</span>
          ))}
        </div>
        <div className="relative h-52 min-w-0 flex-1">
          {/* gridlines */}
          {ticks.map((t) => (
            <div key={t} aria-hidden className={cn("absolute inset-x-0", t === 0 ? "border-t-2 border-slate-300" : "border-t border-slate-100")} style={{ bottom: `${(t / top) * 100}%` }} />
          ))}
          {/* resumption line */}
          {lateFrom > 0 && (
            <div aria-hidden className="absolute inset-y-0 z-10 border-l border-dashed border-amber-500" style={{ left: `${(lateFrom / buckets.length) * 100}%` }}>
              <span className="absolute -top-1 left-1.5 whitespace-nowrap rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">Resumption {resumption}</span>
            </div>
          )}
          {/* bars */}
          <ol className="absolute inset-0 flex items-end gap-[3px]" aria-label="Arrivals by time">
            {buckets.map((b, i) => (
              <li key={b.start} className="group relative flex h-full flex-1 items-end" aria-label={`${b.start}–${b.end}: ${b.count} arrival${b.count === 1 ? "" : "s"}${b.late ? ", late" : ""}`}>
                <div
                  className={cn("motion-grow-y w-full rounded-t-[3px]", b.late ? "bg-warn" : "bg-brand", b.count === 0 && "opacity-0")}
                  style={{ height: `${(b.count / top) * 100}%`, "--d": `${120 + i * 28}ms` } as React.CSSProperties}
                />
                <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs text-white opacity-0 shadow transition-opacity group-hover:opacity-100">
                  {b.start}–{b.end} · {b.count}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      {/* x labels */}
      <div className="ml-10 mt-2 flex text-[11px] tabular-nums text-muted-foreground" aria-hidden>
        {buckets.map((b, i) => (
          <span key={b.start} className="flex-1">{i % every === 0 ? b.start : ""}</span>
        ))}
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span><span className="font-medium text-ink tabular-nums">{total.toLocaleString()}</span> arrivals so far</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-brand" /> On time</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-warn" /> Late ({late})</span>
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------ By class bars */

export type ClassRow = { id: string; name: string; total: number; present: number; late: number; absent: number; excused: number; pending: number };

export function ClassBars({ rows }: { rows: ClassRow[] }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((c, i) => {
        const inSchool = c.present + c.late;
        const pct = (n: number) => (c.total ? (n / c.total) * 100 : 0);
        return (
          <li key={c.id}>
            <Link href={`/today/class/${c.id}`} className="motion-press group grid grid-cols-[72px_1fr_auto] items-center gap-4 px-1 py-3 focus-visible:outline-2 focus-visible:outline-warn sm:grid-cols-[96px_1fr_auto]">
              <span className="truncate font-medium text-ink group-hover:text-brand">{c.name}</span>
              <span className="flex h-2 overflow-hidden rounded-full bg-brand-light/70" role="img"
                aria-label={`${c.present} on time, ${c.late} late, ${c.absent} absent, ${c.excused} excused, ${c.pending} not in yet`}>
                <span className="motion-grow-x h-full bg-brand" style={{ width: `${pct(c.present)}%`, "--d": `${200 + i * 60}ms` } as React.CSSProperties} />
                <span className="motion-grow-x h-full bg-warn" style={{ width: `${pct(c.late)}%`, "--d": `${260 + i * 60}ms` } as React.CSSProperties} />
                <span className="motion-grow-x h-full bg-red-400" style={{ width: `${pct(c.absent)}%`, "--d": `${320 + i * 60}ms` } as React.CSSProperties} />
                <span className="h-full bg-slate-300" style={{ width: `${pct(c.excused)}%` }} />
              </span>
              <span className="text-right text-sm tabular-nums">
                <span className="font-medium text-ink">{inSchool}</span><span className="text-muted-foreground"> of {c.total}</span>
                {c.absent > 0 && <span className="block text-xs text-red-700">{c.absent} absent</span>}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/* --------------------------------------------------------------- Gate feed */

export type FeedItem = {
  id: string;
  name: string;
  sub: string;
  photoUrl: string | null;
  time: string;
  result: "signed_in" | "signed_out" | "duplicate" | "unknown" | "blocked";
  late: boolean;
  fresh: boolean; // tapped in the last couple of minutes → highlight as it arrives
};

const FEED: Record<FeedItem["result"], [PillTone, string]> = {
  signed_in: ["green", "In"], signed_out: ["teal", "Out"], duplicate: ["slate", "Repeat"], unknown: ["red", "Unknown card"], blocked: ["red", "Blocked"],
};

export function GateFeed({ items }: { items: FeedItem[] }) {
  return (
    <ul className="divide-y divide-border" aria-live="polite">
      {items.map((t, i) => {
        const [tone, label] = t.late && t.result === "signed_in" ? (["amber", "Late"] as [PillTone, string]) : FEED[t.result];
        return (
          <li key={t.id} className={cn("flex items-center gap-3 px-4 py-2.5", t.fresh ? "motion-feed-in" : "motion-rise")} style={{ "--d": `${i * 50}ms` } as React.CSSProperties}>
            {t.result === "unknown" || (t.result === "blocked" && !t.photoUrl && t.sub === "Not linked to anyone") ? (
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-700"><CreditCard className="size-4" aria-hidden /></span>
            ) : (
              <PersonAvatar name={t.name} src={t.photoUrl} size="sm" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{t.name}</p>
              <p className="truncate text-xs text-muted-foreground">{t.sub}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <StatusPill tone={tone} dot={false}>{label}</StatusPill>
              <span className="text-xs tabular-nums text-muted-foreground">{t.time}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** "Live" with a pulsing dot. */
export function LiveDot({ label = "Live" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand">
      <span className="motion-live relative size-2 rounded-full bg-current text-brand" aria-hidden />
      {label}
    </span>
  );
}

/** Section heading outside its card (overview pattern), with an optional link on the right. */
export function BlockHeading({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {right}
    </div>
  );
}
