/**
 * Attendance reports (build plan §7 stage 5). Totals come from the SQL functions
 * attendance_summary / attendance_days, which run under the caller's RLS.
 */
export type DayStatus = "present" | "late" | "absent" | "excused" | "pending";

export type SummaryRow = {
  student_id: string;
  class_id: string | null;
  school_days: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
};

export const MAX_RANGE_DAYS = 200; // about a school year's term and a half

/**
 * Attendance rate = days attended (on time or late) ÷ school days that counted.
 * Excused days don't count against the student. null when there is nothing to count.
 */
export function attendanceRate(r: Pick<SummaryRow, "school_days" | "present" | "late" | "excused">): number | null {
  const counted = r.school_days - r.excused;
  if (counted <= 0) return null;
  return Math.round(((r.present + r.late) / counted) * 1000) / 10;
}

export function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${rate}%`;
}

/** Validates a report range from the URL; falls back to this week (Mon → today). */
export function parseRange(from: string | undefined, to: string | undefined, today: string): { from: string; to: string; error?: string } {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const monday = (() => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  })();
  const f = from && iso.test(from) ? from : monday;
  const t = to && iso.test(to) ? to : today;
  if (f > t) return { from: t, to: f, error: "The start date was after the end date, so they were swapped." };
  const days = (Date.parse(t) - Date.parse(f)) / 86_400_000;
  if (days > MAX_RANGE_DAYS) {
    const capped = new Date(Date.parse(t) - MAX_RANGE_DAYS * 86_400_000).toISOString().slice(0, 10);
    return { from: capped, to: t, error: `Reports cover at most ${MAX_RANGE_DAYS} days, so the start date was moved to ${capped}.` };
  }
  return { from: f, to: t };
}

/** Quick ranges for the date picker. */
export function presetRanges(today: string): { label: string; from: string; to: string }[] {
  const d = (offset: number) => {
    const x = new Date(`${today}T12:00:00Z`);
    x.setUTCDate(x.getUTCDate() + offset);
    return x.toISOString().slice(0, 10);
  };
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const monthStart = `${today.slice(0, 7)}-01`;
  return [
    { label: "Today", from: today, to: today },
    { label: "This week", from: d(-dow), to: today },
    { label: "Last week", from: d(-dow - 7), to: d(-dow - 3) },
    { label: "This month", from: monthStart, to: today },
    { label: "Last 30 days", from: d(-29), to: today },
  ];
}

/** Totals across many students. */
export function totals(rows: SummaryRow[]) {
  const t = rows.reduce(
    (a, r) => ({ school_days: a.school_days + r.school_days, present: a.present + r.present, late: a.late + r.late, absent: a.absent + r.absent, excused: a.excused + r.excused }),
    { school_days: 0, present: 0, late: 0, absent: 0, excused: 0 },
  );
  return { ...t, rate: attendanceRate(t) };
}

/**
 * Supabase returns at most 1,000 rows per request; this pages through an RPC until done.
 * `call(from, to)` must apply `.range(from, to)`.
 */
export async function fetchAllPages<T>(call: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, pageSize = 1000, maxRows = 200_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await call(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}
