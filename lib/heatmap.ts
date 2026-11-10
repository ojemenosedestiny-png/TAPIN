/**
 * Attendance calendar heatmap: one cell per school day (Mon–Fri) for the last N weeks.
 */
export type DayStatus = "present" | "late" | "absent" | "holiday" | "future" | "before";
export type HeatCell = { date: string; status: DayStatus; time?: string };

import { localDate, localTime } from "@/lib/time";

export { localDate, localTime };

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Weeks are columns, Mon–Fri rows. Ends with the week containing `today`.
 * Days before `since` (e.g. when the student was added) are "before", not absent.
 */
export function buildHeatmap(opts: {
  today: string; // YYYY-MM-DD in school timezone
  weeks: number;
  attendance: { date: string; sign_in_at: string | null }[];
  holidays: string[];
  resumptionTime: string; // "07:45" or "07:45:00"
  timeZone: string;
  since?: string;
}): HeatCell[][] {
  const byDate = new Map(opts.attendance.map((a) => [a.date, a]));
  const holidays = new Set(opts.holidays);
  const resumption = opts.resumptionTime.slice(0, 5);
  const todayDow = (new Date(`${opts.today}T12:00:00Z`).getUTCDay() + 6) % 7; // Mon=0
  const monday = addDays(opts.today, -todayDow);

  const columns: HeatCell[][] = [];
  for (let w = opts.weeks - 1; w >= 0; w--) {
    const col: HeatCell[] = [];
    for (let d = 0; d < 5; d++) {
      const date = addDays(monday, d - 7 * w);
      const row = byDate.get(date);
      let status: DayStatus;
      let time: string | undefined;
      if (date > opts.today) status = "future";
      else if (opts.since && date < opts.since) status = "before";
      else if (holidays.has(date)) status = "holiday";
      else if (row?.sign_in_at) {
        time = localTime(row.sign_in_at, opts.timeZone);
        status = time > resumption ? "late" : "present";
      } else status = "absent";
      col.push({ date, status, time });
    }
    columns.push(col);
  }
  return columns;
}
