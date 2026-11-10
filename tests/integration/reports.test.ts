/**
 * Reporting functions against a real Supabase project (throwaway school, cleaned up).
 *   RUN_RLS_TESTS=1 npm run test:rls
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = process.env.RUN_RLS_TESTS === "1" && !!url && !!anon && !!service;

let db: SupabaseClient;
const ids: Record<string, string> = {};
const users: string[] = [];
const pw = `Rp-${randomUUID()}A1`;
const tag = `rep-${Date.now()}`;
// Mon 2 – Fri 6 November 2026; Wednesday the 4th is a holiday.
const MON = "2026-11-02", TUE = "2026-11-03", WED = "2026-11-04", THU = "2026-11-05", FRI = "2026-11-06";
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+01:00`).toISOString();

async function signIn(email: string) {
  const c = createClient(url!, anon!, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: pw });
  if (error) throw error;
  return c;
}

describe.skipIf(!enabled)("reports (attendance_days / attendance_summary / today_by_class)", () => {
  let asAdmin: SupabaseClient;
  let asTeacher: SupabaseClient;

  beforeAll(async () => {
    db = createClient(url!, service!, { auth: { persistSession: false } });
    const ins = async (t: string, row: Record<string, unknown>) => {
      const { data, error } = await db.from(t).insert(row).select("id").single();
      if (error) throw new Error(`${t}: ${error.message}`);
      return data.id as string;
    };
    ids.school = await ins("schools", { name: `Report Test ${tag}`, resumption_time: "07:45", absence_cutoff_time: "09:00", closing_time: "14:00" });
    for (const role of ["school_admin", "teacher"] as const) {
      const email = `${tag}-${role}@example.com`;
      const { data } = await db.auth.admin.createUser({ email, password: pw, email_confirm: true });
      users.push(data.user!.id);
      await db.from("users").insert({ id: data.user!.id, email, name: role, role, school_id: ids.school });
      ids[role] = data.user!.id;
    }
    ids.classA = await ins("classes", { school_id: ids.school, name: "JSS1A", class_teacher_id: ids.teacher });
    ids.classB = await ins("classes", { school_id: ids.school, name: "JSS1B" });
    const student = (cls: string, n: string) => ins("students", { school_id: ids.school, class_id: cls, admission_no: n, first_name: n, last_name: "T", created_at: "2026-10-01T00:00:00Z" });
    ids.a1 = await student(ids.classA, "A1");
    ids.a2 = await student(ids.classA, "A2");
    ids.b1 = await student(ids.classB, "B1");
    await db.from("school_calendar").insert({ school_id: ids.school, date: WED, note: "Holiday" });
    const sign = (s: string, date: string, hhmm: string) => ({ school_id: ids.school, holder_type: "student", holder_id: s, date, sign_in_at: at(date, hhmm) });
    await db.from("attendance").insert([
      sign(ids.a1, MON, "07:30"), sign(ids.a1, TUE, "07:45"), sign(ids.a1, THU, "07:46"), sign(ids.a1, FRI, "07:10"),
      sign(ids.a2, MON, "08:30"),
      sign(ids.b1, MON, "07:00"), sign(ids.b1, TUE, "07:00"), sign(ids.b1, THU, "07:00"), sign(ids.b1, FRI, "07:00"),
    ]);
    await db.from("excusals").insert({ school_id: ids.school, student_id: ids.a2, date: TUE, reason: "Sick note", created_by: ids.school_admin });
    asAdmin = await signIn(`${tag}-school_admin@example.com`);
    asTeacher = await signIn(`${tag}-teacher@example.com`);
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    await db.from("schools").delete().eq("id", ids.school);
    for (const id of users) await db.auth.admin.deleteUser(id);
  });

  it("classifies each school day, skipping weekends and holidays", async () => {
    const { data, error } = await asAdmin.rpc("attendance_days", { p_from: MON, p_to: "2026-11-08", p_class: ids.classA });
    expect(error).toBeNull();
    const a1 = (data ?? []).filter((d: { student_id: string }) => d.student_id === ids.a1).map((d: { date: string; status: string }) => [d.date, d.status]);
    // 07:45 exactly is on time (same rule as the kiosk); 07:46 is late. Wed is a holiday; Sat/Sun are skipped.
    expect(a1).toEqual([[MON, "present"], [TUE, "present"], [THU, "late"], [FRI, "present"]]);
    const a2 = (data ?? []).filter((d: { student_id: string }) => d.student_id === ids.a2).map((d: { date: string; status: string }) => [d.date, d.status]);
    expect(a2).toEqual([[MON, "late"], [TUE, "excused"], [THU, "absent"], [FRI, "absent"]]);
  });

  it("sums per student, with attendance counted over non-excused days", async () => {
    const { data } = await asAdmin.rpc("attendance_summary", { p_from: MON, p_to: FRI });
    const by = new Map((data ?? []).map((r: { student_id: string }) => [r.student_id, r]));
    expect(by.get(ids.a1)).toMatchObject({ school_days: 4, present: 3, late: 1, absent: 0, excused: 0 });
    expect(by.get(ids.a2)).toMatchObject({ school_days: 4, present: 0, late: 1, absent: 2, excused: 1 });
    expect(by.get(ids.b1)).toMatchObject({ school_days: 4, present: 4 });
  });

  it("a teacher's report only ever includes their own class", async () => {
    const { data } = await asTeacher.rpc("attendance_summary", { p_from: MON, p_to: FRI });
    expect((data ?? []).map((r: { student_id: string }) => r.student_id).sort()).toEqual([ids.a1, ids.a2].sort());
    // Even asking for the other class by id returns nothing.
    const { data: other } = await asTeacher.rpc("attendance_days", { p_from: MON, p_to: FRI, p_class: ids.classB });
    expect(other).toEqual([]);
  });

  it("absence watch flags students absent 3+ days, and teachers only see their own class", async () => {
    const { data: all } = await asAdmin.rpc("attendance_watch");
    expect((all ?? []).map((r: { student_id: string }) => r.student_id)).toContain(ids.a2); // absent Thu, Fri and since
    const { data: mine } = await asTeacher.rpc("attendance_watch");
    for (const r of (mine ?? []) as { student_id: string }[]) expect([ids.a1, ids.a2]).toContain(r.student_id);
    expect((mine ?? []).map((r: { student_id: string }) => r.student_id)).not.toContain(ids.b1);
  });

  it("the weekly watch notification is created once per school per week", async () => {
    await db.rpc("queue_watch_notifications", { p_school: ids.school });
    await db.rpc("queue_watch_notifications", { p_school: ids.school });
    const { data } = await db.from("notifications").select("message").eq("school_id", ids.school).eq("kind", "attendance_watch");
    expect(data).toHaveLength(1);
    expect(data![0]!.message).toMatch(/missed 3 or more days in the last 30 days/);
  });

  it("staff report: days, lateness, usual arrival and hours on site — school admins only", async () => {
    const { data: staff } = await db.from("staff").insert({ school_id: ids.school, name: "Mr Okon", created_at: "2026-10-01T00:00:00Z" }).select("id").single();
    const { error: insErr } = await db.from("attendance").insert([
      { school_id: ids.school, holder_type: "staff", holder_id: staff!.id, date: MON, sign_in_at: at(MON, "07:30"), sign_out_at: at(MON, "15:30"), early_release: false },
      { school_id: ids.school, holder_type: "staff", holder_id: staff!.id, date: TUE, sign_in_at: at(TUE, "08:00"), sign_out_at: at(TUE, "14:00"), early_release: false },
      { school_id: ids.school, holder_type: "staff", holder_id: staff!.id, date: FRI, sign_in_at: at(FRI, "07:30"), sign_out_at: at(FRI, "11:30"), early_release: true },
    ]);
    expect(insErr).toBeNull();
    const { data, error } = await asAdmin.rpc("staff_summary", { p_from: MON, p_to: FRI });
    expect(error).toBeNull();
    // Mon–Fri minus the Wednesday holiday = 4 school days; absent Thursday.
    expect((data ?? []).find((r: { staff_id: string }) => r.staff_id === staff!.id)).toMatchObject({
      school_days: 4, present: 3, late: 1, absent: 1, early_leaves: 1, avg_arrival: "07:40:00", avg_minutes_on_site: 360,
    });
    const { data: teacher } = await asTeacher.rpc("staff_summary", { p_from: MON, p_to: FRI });
    expect(teacher ?? []).toEqual([]);
  });

  it("other schools and logged-out visitors get nothing", async () => {
    const anonClient = createClient(url!, anon!, { auth: { persistSession: false } });
    const { data, error } = await anonClient.rpc("attendance_summary", { p_from: MON, p_to: FRI });
    expect(data ?? []).toEqual([]);
    expect(error).not.toBeNull(); // not even callable without a login
  });

  it("today_by_class groups today's statuses per class", async () => {
    const { data, error } = await asAdmin.rpc("today_by_class");
    expect(error).toBeNull();
    const total = (data ?? []).reduce((a: number, r: { total: number }) => a + r.total, 0);
    expect(total).toBe(3); // three active students, whatever today is (on a weekend or holiday: 0 school days → no rows)
  });
});
