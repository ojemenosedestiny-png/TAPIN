/**
 * Monthly teacher report (spec 8). Pure functions, unit tested.
 * Per teacher: days present, average arrival, late days, lessons taught, teaching minutes,
 * flagged lessons and missed sign-outs; ranked by teaching time, compared with last month.
 */
import { localTime } from "@/lib/time";

export type MonthAttendance = { holder_id: string; date: string; sign_in_at: string | null; sign_out_at: string | null; auto_signed_out: boolean };
export type MonthLesson = { staff_id: string; duration_minutes: number | null; flags: string[]; status: string };

export type TeacherMonth = {
  staffId: string;
  name: string;
  schoolDays: number;
  present: number;
  late: number;
  avgArrival: string | null; // "07:41"
  lessons: number;
  minutes: number;
  flagged: number;
  missedSignOuts: number;
  rank: number;
};

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "2026-11" → valid month string, or the fallback. */
export function parseMonth(raw: string | undefined | null, fallback: string): string {
  return raw && MONTH.test(raw) ? raw : fallback;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/** First and last day of the month, as YYYY-MM-DD. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat("en-NG", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** Weekdays of the month up to and including `today`, minus holidays. */
export function schoolDays(month: string, today: string, holidays: ReadonlySet<string>): string[] {
  const { from, to } = monthRange(month);
  const end = to < today ? to : today;
  const out: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(iso)) out.push(iso);
  }
  return out;
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;

export function buildTeacherMonth(opts: {
  staff: { id: string; name: string }[];
  days: string[];
  today: string;
  attendance: MonthAttendance[];
  lessons: MonthLesson[];
  timeZone: string;
  resumptionTime: string; // "07:45" or "07:45:00"
}): TeacherMonth[] {
  const { staff, days, today, attendance, lessons, timeZone } = opts;
  const resumption = toMin(opts.resumptionTime.slice(0, 5));
  const daySet = new Set(days);

  const rows = staff.map((s) => {
    const mine = attendance.filter((a) => a.holder_id === s.id && daySet.has(a.date) && a.sign_in_at);
    const arrivals = mine.map((a) => toMin(localTime(a.sign_in_at!, timeZone)));
    const taught = lessons.filter((l) => l.staff_id === s.id && l.status !== "open");
    return {
      staffId: s.id,
      name: s.name,
      schoolDays: days.length,
      present: mine.length,
      late: arrivals.filter((m) => m > resumption).length,
      avgArrival: arrivals.length ? fromMin(arrivals.reduce((a, b) => a + b, 0) / arrivals.length) : null,
      lessons: taught.length,
      minutes: taught.reduce((sum, l) => sum + (l.duration_minutes ?? 0), 0),
      flagged: taught.filter((l) => l.flags.length > 0).length,
      // Signed out by the auto-close, or never signed out on an earlier day.
      missedSignOuts: mine.filter((a) => a.auto_signed_out || (!a.sign_out_at && a.date < today)).length,
      rank: 0,
    };
  });

  // Ranked by teaching time, then days present; equal results share a rank.
  const sorted = [...rows].sort((a, b) => b.minutes - a.minutes || b.present - a.present || a.name.localeCompare(b.name));
  sorted.forEach((r, i) => {
    const prev = sorted[i - 1];
    r.rank = prev && prev.minutes === r.minutes && prev.present === r.present ? prev.rank : i + 1;
  });
  return sorted;
}

/** Change from last month, for the "vs last month" column. Null when there's nothing to compare. */
export function delta(now: number, before: number | undefined): number | null {
  return before === undefined ? null : now - before;
}
