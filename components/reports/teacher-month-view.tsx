import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { PoweredBy } from "@/components/brand/powered-by";
import { formatMinutes } from "@/lib/lessons";
import { delta, monthLabel, type TeacherMonth } from "@/lib/teacher-report";
import type { MonthlyReport } from "@/lib/teacher-report-data";
import { cn } from "@/lib/utils";

const arrival = (t: string | null) => {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number) as [number, number];
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

function Change({ value, unit = "", goodWhenUp = true }: { value: number | null; unit?: "min" | ""; goodWhenUp?: boolean }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  if (value === 0) return <span className="text-muted-foreground">same</span>;
  const up = value > 0;
  const good = up === goodWhenUp;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 whitespace-nowrap font-medium", good ? "text-green-800" : "text-red-700")}>
      <Icon className="size-3.5" aria-hidden />{unit === "min" ? formatMinutes(Math.abs(value)) : Math.abs(value)}
      <span className="sr-only">{up ? " more" : " fewer"} than last month</span>
    </span>
  );
}

/** Branded header: prints as the top of the PDF. */
function ReportHeader({ report, subtitle }: { report: MonthlyReport; subtitle: string }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
      <div className="flex items-center gap-4">
        {report.school.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={report.school.logoUrl} alt="" className="size-14 rounded-xl bg-white object-contain p-1.5 ring-1 ring-border" />
        ) : <Logo className="size-14" />}
        <div>
          <p className="font-heading text-2xl font-semibold text-ink">{report.school.name}</p>
          <p className="text-sm text-muted-foreground">{subtitle} · {monthLabel(report.month)} · {report.schoolDays} school days</p>
        </div>
      </div>
      <PoweredBy />
    </header>
  );
}

/** The whole school: ranking, chart and table. */
export function TeacherMonthView({ report }: { report: MonthlyReport }) {
  const rows = report.rows;
  const total = rows.reduce((t, r) => ({ lessons: t.lessons + r.lessons, minutes: t.minutes + r.minutes, flagged: t.flagged + r.flagged, missed: t.missed + r.missedSignOuts, present: t.present + r.present }), { lessons: 0, minutes: 0, flagged: 0, missed: 0, present: 0 });
  const possible = rows.length * report.schoolDays;
  const top = Math.max(1, ...rows.map((r) => r.minutes));

  return (
    <article className="space-y-6 [print-color-adjust:exact]">
      <ReportHeader report={report} subtitle="Teacher report" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: "Attendance", value: possible ? `${Math.round((total.present / possible) * 100)}%` : "—" },
          { label: "Lessons taught", value: total.lessons.toLocaleString() },
          { label: "Teaching time", value: total.minutes ? formatMinutes(total.minutes) : "—" },
          { label: "Flagged lessons", value: total.flagged.toLocaleString(), warn: total.flagged > 0 },
          { label: "Missed sign-outs", value: total.missed.toLocaleString(), warn: total.missed > 0 },
        ].map((k) => (
          <div key={k.label} className="surface rounded-2xl px-4 py-4">
            <p className="text-sm text-muted-foreground">{k.label}</p>
            <p className={cn("mt-1 font-heading text-2xl font-semibold tabular-nums", k.warn ? "text-amber-800" : "text-ink")}>{k.value}</p>
          </div>
        ))}
      </div>

      {rows.length > 0 && (
        <section className="surface rounded-2xl p-5" aria-labelledby="chart-h">
          <h2 id="chart-h" className="font-semibold text-ink">Teaching time by teacher</h2>
          <ul className="mt-4 space-y-2.5">
            {rows.map((r) => (
              <li key={r.staffId} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,12rem)_1fr_auto]">
                <span className="truncate text-ink">{r.name}</span>
                <span className="h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className="block h-full rounded-full bg-brand" style={{ width: `${(r.minutes / top) * 100}%` }} />
                </span>
                <span className="w-16 text-right tabular-nums text-muted-foreground">{r.minutes ? formatMinutes(r.minutes) : "—"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="table-h">
        <h2 id="table-h" className="sr-only">Every teacher</h2>
        <div className="surface overflow-x-auto rounded-xl">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-3 font-medium">#</th>
                <th scope="col" className="px-3 py-3 font-medium">Teacher</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Present</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Usual arrival</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Late</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Lessons</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Teaching time</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Flagged</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Missed sign-out</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">vs last month</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const before = report.previous.get(r.staffId);
                return (
                  <tr key={r.staffId}>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{r.rank}</td>
                    <td className="px-3 py-2.5 font-medium text-ink">{r.name}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.present}/{r.schoolDays}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{arrival(r.avgArrival)}</td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", r.late && "text-amber-800")}>{r.late}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.lessons}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.minutes ? formatMinutes(r.minutes) : "—"}</td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", r.flagged && "text-amber-800")}>{r.flagged}</td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", r.missedSignOuts && "text-amber-800")}>{r.missedSignOuts}</td>
                    <td className="px-3 py-2.5 text-right"><Change value={delta(r.minutes, before?.minutes)} unit="min" /></td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">No active staff.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Ranked by teaching time, then days present. &ldquo;vs last month&rdquo; compares teaching time.</p>
      </section>
    </article>
  );
}

/** One teacher's own record (what a teacher sees). No ranking against colleagues. */
export function OwnMonthView({ report, row }: { report: MonthlyReport; row: TeacherMonth }) {
  const before = report.previous.get(row.staffId);
  const tiles: { label: string; value: string; change: React.ReactNode }[] = [
    { label: "Days present", value: `${row.present} of ${row.schoolDays}`, change: <Change value={delta(row.present, before?.present)} /> },
    { label: "Usual arrival", value: arrival(row.avgArrival), change: null },
    { label: "Late days", value: String(row.late), change: <Change value={delta(row.late, before?.late)} goodWhenUp={false} /> },
    { label: "Lessons taught", value: String(row.lessons), change: <Change value={delta(row.lessons, before?.lessons)} /> },
    { label: "Teaching time", value: row.minutes ? formatMinutes(row.minutes) : "—", change: <Change value={delta(row.minutes, before?.minutes)} unit="min" /> },
    { label: "Flagged lessons", value: String(row.flagged), change: <Change value={delta(row.flagged, before?.flagged)} goodWhenUp={false} /> },
    { label: "Missed sign-outs", value: String(row.missedSignOuts), change: <Change value={delta(row.missedSignOuts, before?.missedSignOuts)} goodWhenUp={false} /> },
  ];
  return (
    <article className="space-y-6 [print-color-adjust:exact]">
      <ReportHeader report={report} subtitle={row.name} />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <li key={t.label} className="surface rounded-2xl px-4 py-4">
            <p className="text-sm text-muted-foreground">{t.label}</p>
            <p className="mt-1 font-heading text-2xl font-semibold tabular-nums text-ink">{t.value}</p>
            {t.change !== null && <p className="mt-1 text-xs text-muted-foreground">{t.change} <span aria-hidden>vs last month</span></p>}
          </li>
        ))}
      </ul>
    </article>
  );
}
