import ExcelJS from "exceljs";
import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccess } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { attendanceRate, parseRange } from "@/lib/reports";
import { loadReport, loadReportDays } from "@/lib/report-data";
import { friendlyTime, localDate } from "@/lib/time";
import { writeAudit } from "@/lib/audit";

export const maxDuration = 60;

const STATUS_WORD = { present: "Present", late: "Late", absent: "Absent", excused: "Excused", pending: "Not in yet" } as const;

/** GET /api/reports/export?from&to&class — Excel workbook: a summary sheet and a day-by-day sheet. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.needsMfa || !user.schoolId || !canAccess(user.role, "reports")) return new Response("Sign in first.", { status: 401 });
  if (!checkRateLimit(`export:${user.id}`, { max: 20, windowMs: 10 * 60_000 }).ok) return new Response("Too many exports. Try again in a few minutes.", { status: 429 });

  const db = await createClient(); // RLS: teachers only export their own classes
  const { data: school } = await db.from("schools").select("name, timezone").eq("id", user.schoolId).single();
  if (!school) return new Response("School not found.", { status: 404 });
  const sp = req.nextUrl.searchParams;
  const range = parseRange(sp.get("from") ?? undefined, sp.get("to") ?? undefined, localDate(new Date(), school.timezone));
  const classId = /^[0-9a-f-]{36}$/i.test(sp.get("class") ?? "") ? sp.get("class") : null;

  const [{ rows }, days] = await Promise.all([loadReport(db, { ...range, classId }), loadReportDays(db, { ...range, classId })]);
  const names = new Map(rows.map((r) => [r.student_id, r.student]));

  const wb = new ExcelJS.Workbook();
  wb.creator = "TapIn";
  wb.created = new Date();
  const header = (ws: ExcelJS.Worksheet) => {
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };

  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Admission No", key: "adm", width: 14 }, { header: "Name", key: "name", width: 28 }, { header: "Class", key: "class", width: 10 },
    { header: "School days", key: "days", width: 12 }, { header: "Present", key: "present", width: 10 }, { header: "Late", key: "late", width: 8 },
    { header: "Absent", key: "absent", width: 9 }, { header: "Excused", key: "excused", width: 9 }, { header: "Attendance %", key: "rate", width: 13 },
  ];
  header(summary);
  for (const r of [...rows].sort((a, b) => (a.student.class_name ?? "").localeCompare(b.student.class_name ?? "", "en", { numeric: true }) || a.student.full_name.localeCompare(b.student.full_name))) {
    const rate = attendanceRate(r);
    summary.addRow({
      adm: r.student.admission_no, name: r.student.full_name, class: r.student.class_name ?? "", days: r.school_days,
      present: r.present, late: r.late, absent: r.absent, excused: r.excused, rate: rate === null ? "" : rate / 100,
    });
  }
  summary.getColumn("rate").numFmt = "0.0%";

  const daily = wb.addWorksheet("Daily");
  daily.columns = [
    { header: "Date", key: "date", width: 12 }, { header: "Admission No", key: "adm", width: 14 }, { header: "Name", key: "name", width: 28 },
    { header: "Class", key: "class", width: 10 }, { header: "Status", key: "status", width: 12 }, { header: "Signed in", key: "in", width: 11 }, { header: "Signed out", key: "out", width: 11 },
  ];
  header(daily);
  for (const d of days) {
    const s = names.get(d.student_id);
    if (!s) continue;
    daily.addRow({
      date: d.date, adm: s.admission_no, name: s.full_name, class: s.class_name ?? "", status: STATUS_WORD[d.status],
      in: d.sign_in_at ? friendlyTime(d.sign_in_at, school.timezone) : "", out: d.sign_out_at ? friendlyTime(d.sign_out_at, school.timezone) : "",
    });
  }

  const about = wb.addWorksheet("About");
  about.addRows([
    ["School", school.name], ["From", range.from], ["To", range.to], ["Class", classId ? rows[0]?.student.class_name ?? "" : "All classes"],
    ["Exported", new Date().toISOString()], ["Exported by", user.name],
    ["Note", "Attendance % = (present + late) ÷ (school days − excused). Weekends and holidays are not school days."],
  ]);
  about.getColumn(1).font = { bold: true };
  about.getColumn(1).width = 14;
  about.getColumn(2).width = 80;

  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "report.export", entity: "attendance", details: { ...range, classId, rows: rows.length } });

  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  const file = `tapin-attendance-${range.from}-to-${range.to}.xlsx`;
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "no-store",
    },
  });
}
