import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccess } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseRange } from "@/lib/reports";
import { friendlyTime, localDate } from "@/lib/time";
import { FLAG_LABEL, type LessonFlag } from "@/lib/lessons";
import { writeAudit } from "@/lib/audit";

const uuid = /^[0-9a-f-]{36}$/i;

/** A CSV cell: quoted, and safe to open in Excel (no formulas). */
function cell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** GET /api/reports/lessons?from&to&teacher&class&subject&flagged — the lesson log as CSV. School admins only. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.needsMfa || !user.schoolId || !canAccess(user.role, "lessons")) return new Response("Sign in first.", { status: 401 });
  if (!checkRateLimit(`export:${user.id}`, { max: 20, windowMs: 10 * 60_000 }).ok) return new Response("Too many exports. Try again in a few minutes.", { status: 429 });

  const db = await createClient();
  const { data: school } = await db.from("schools").select("name, timezone").eq("id", user.schoolId).single();
  if (!school) return new Response("School not found.", { status: 404 });
  const sp = req.nextUrl.searchParams;
  const range = parseRange(sp.get("from") ?? undefined, sp.get("to") ?? undefined, localDate(new Date(), school.timezone));

  let q = db.from("lessons").select("staff_id, class_name, subject_name, date, started_at, ended_at, duration_minutes, status, flags")
    .gte("date", range.from).lte("date", range.to).order("started_at").limit(20_000);
  const teacher = sp.get("teacher"), cls = sp.get("class"), subject = sp.get("subject");
  if (teacher && uuid.test(teacher)) q = q.eq("staff_id", teacher);
  if (cls && uuid.test(cls)) q = q.eq("class_id", cls);
  if (subject && uuid.test(subject)) q = q.eq("subject_id", subject);
  if (sp.get("flagged") === "1") q = q.neq("flags", "{}");
  const [{ data: rows }, { data: staff }] = await Promise.all([q, db.from("staff").select("id, name")]);
  const nameOf = new Map((staff ?? []).map((s) => [s.id, s.name]));

  const lines = [["Date", "Teacher", "Class", "Subject", "Started", "Ended", "Minutes", "Status", "Flags"].map(cell).join(",")];
  for (const r of rows ?? []) {
    lines.push([
      r.date, nameOf.get(r.staff_id) ?? "Former staff", r.class_name, r.subject_name,
      friendlyTime(r.started_at, school.timezone), r.ended_at ? friendlyTime(r.ended_at, school.timezone) : "",
      r.duration_minutes, r.status === "auto_closed" ? "Closed automatically" : r.status === "open" ? "Running" : "Ended",
      ((r.flags ?? []) as LessonFlag[]).map((f) => FLAG_LABEL[f] ?? f).join("; "),
    ].map(cell).join(","));
  }
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "report.export", entity: "lessons", details: { from: range.from, to: range.to, rows: rows?.length ?? 0 } });

  const file = `lessons-${range.from}-to-${range.to}.csv`;
  return new Response("﻿" + lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file}"`, "Cache-Control": "no-store" },
  });
}
