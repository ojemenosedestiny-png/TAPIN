import type { DayStatus, HeatCell } from "@/lib/heatmap";
import { cn } from "@/lib/utils";

const COLOR: Record<DayStatus, string> = {
  present: "bg-success",
  late: "bg-warn",
  absent: "bg-danger/80",
  excused: "bg-slate-400",
  holiday: "bg-slate-200",
  future: "bg-transparent ring-1 ring-inset ring-border",
  before: "bg-slate-100",
};
const LABEL: Record<DayStatus, string> = {
  present: "Present", late: "Late", absent: "Absent", excused: "Excused", holiday: "Holiday", future: "Upcoming", before: "Not enrolled yet",
};

export function AttendanceHeatmap({ columns }: { columns: HeatCell[][] }) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const counted = columns.flat().filter((c) => c.status === "present" || c.status === "late" || c.status === "absent");
  // Excused days are not counted against attendance.
  const present = counted.filter((c) => c.status !== "absent").length;

  return (
    <figure>
      <div className="flex gap-2">
        <div className="grid grid-rows-5 gap-1 text-[10px] leading-4 text-muted-foreground" aria-hidden>
          {days.map((d) => <span key={d}>{d}</span>)}
        </div>
        <div className="flex gap-1 overflow-x-auto" role="img" aria-label={`Present ${present} of ${counted.length} school days`}>
          {columns.map((col, i) => (
            <div key={i} className="grid grid-rows-5 gap-1">
              {col.map((c) => (
                <span key={c.date} title={`${c.date}: ${LABEL[c.status]}${c.time ? ` at ${c.time}` : ""}`} className={cn("size-4 rounded-[4px]", COLOR[c.status])} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{counted.length ? `${Math.round((present / counted.length) * 100)}% attendance` : "No school days yet"}</span>
        {(["present", "late", "absent", "excused", "holiday"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5"><span className={cn("size-3 rounded-[3px]", COLOR[s])} />{LABEL[s]}</span>
        ))}
      </figcaption>
    </figure>
  );
}
