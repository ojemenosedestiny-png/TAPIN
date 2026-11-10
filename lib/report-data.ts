import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPages, type DayStatus, type SummaryRow } from "@/lib/reports";

export type ReportStudent = { id: string; full_name: string; admission_no: string; class_name: string | null; class_id: string | null };
export type ReportRow = SummaryRow & { student: ReportStudent };
export type ReportDay = { student_id: string; date: string; status: DayStatus; sign_in_at: string | null; sign_out_at: string | null };

/** Loads a report under the caller's RLS (a teacher only gets their own classes). */
export async function loadReport(db: SupabaseClient, opts: { from: string; to: string; classId: string | null }) {
  const [summary, students] = await Promise.all([
    fetchAllPages<SummaryRow>((f, t) => db.rpc("attendance_summary", { p_from: opts.from, p_to: opts.to, p_class: opts.classId }).range(f, t)),
    fetchAllPages<ReportStudent>((f, t) => {
      let q = db.from("student_overview").select("id, full_name, admission_no, class_name, class_id").eq("status", "active").order("last_name").order("first_name");
      if (opts.classId) q = q.eq("class_id", opts.classId);
      return q.range(f, t);
    }),
  ]);
  const byId = new Map(students.map((s) => [s.id, s]));
  const rows: ReportRow[] = summary.filter((r) => byId.has(r.student_id)).map((r) => ({ ...r, student: byId.get(r.student_id)! }));
  return { rows, students };
}

export async function loadReportDays(db: SupabaseClient, opts: { from: string; to: string; classId: string | null }) {
  return fetchAllPages<ReportDay>((f, t) => db.rpc("attendance_days", { p_from: opts.from, p_to: opts.to, p_class: opts.classId }).range(f, t));
}
