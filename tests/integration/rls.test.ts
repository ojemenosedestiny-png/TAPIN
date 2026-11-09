/**
 * Row Level Security check: a user from School A must never see School B data.
 *
 * Runs against a real Supabase project (local or a dev/staging cloud project — NOT production).
 * It creates throwaway schools and users, checks every table, then deletes everything it made.
 *
 *   RUN_RLS_TESTS=1 npm run test:rls
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = process.env.RUN_RLS_TESTS === "1" && !!url && !!anon && !!service;

const tag = `rls-test-${Date.now()}`;
const password = `T3st-${randomUUID()}`;

type Ids = Record<string, string>;
const ids: Ids = {};
const authUserIds: string[] = [];

let admin: SupabaseClient;

async function makeUser(email: string, role: "super_admin" | "school_admin" | "teacher", schoolId: string | null) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  authUserIds.push(data.user.id);
  const { error: e2 } = await admin.from("users").insert({ id: data.user.id, school_id: schoolId, name: email, email, role });
  if (e2) throw e2;
  return data.user.id;
}

async function signIn(email: string) {
  const c = createClient(url!, anon!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return c;
}

async function insert(table: string, row: Record<string, unknown>) {
  const { data, error } = await admin.from(table).insert(row).select().single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data as Record<string, string>;
}

/** Seed one school with one of everything. */
async function seedSchool(key: "A" | "B") {
  const school = await insert("schools", { name: `${tag} School ${key}` });
  ids[`school${key}`] = school.id;
  ids[`admin${key}`] = await makeUser(`${tag}-admin-${key}@example.com`.toLowerCase(), "school_admin", school.id);
  ids[`teacher${key}`] = await makeUser(`${tag}-teacher-${key}@example.com`.toLowerCase(), "teacher", school.id);
  const ownClass = await insert("classes", { school_id: school.id, name: "JSS1A", class_teacher_id: ids[`teacher${key}`] });
  const otherClass = await insert("classes", { school_id: school.id, name: "JSS1B" });
  const s1 = await insert("students", { school_id: school.id, class_id: ownClass.id, admission_no: `${key}-001`, first_name: "Own", last_name: key });
  const s2 = await insert("students", { school_id: school.id, class_id: otherClass.id, admission_no: `${key}-002`, first_name: "Other", last_name: key });
  ids[`ownStudent${key}`] = s1.id;
  ids[`otherStudent${key}`] = s2.id;
  const g = await insert("guardians", { school_id: school.id, name: "Parent", phone: "+2348000000000" });
  await insert("student_guardians", { school_id: school.id, student_id: s1.id, guardian_id: g.id });
  await insert("staff", { school_id: school.id, name: "Gate staff" });
  const uidSuffix = key === "A" ? "0A" : "0B";
  await insert("cards", { school_id: school.id, uid: `04A35B1C${uidSuffix}${Date.now().toString(16).toUpperCase().slice(-6)}`, holder_type: "student", holder_id: s1.id });
  await insert("devices", { school_id: school.id, name: "Main Gate", token_hash: `${tag}-${key}-${randomUUID()}` });
  const today = new Date().toISOString().slice(0, 10);
  await insert("attendance", { school_id: school.id, holder_type: "student", holder_id: s1.id, date: today, sign_in_at: new Date().toISOString() });
  await insert("attendance", { school_id: school.id, holder_type: "student", holder_id: s2.id, date: today, sign_in_at: new Date().toISOString() });
  await insert("sms_logs", { school_id: school.id, phone: "+2348000000000", message: "hi", type: "arrival", dedupe_key: `${tag}-${key}` });
  await insert("school_calendar", { school_id: school.id, date: "2030-12-25", note: "Christmas" });
  await insert("audit_logs", { school_id: school.id, action: "test", entity: "schools" });
}

const TENANT_TABLES = [
  "classes", "students", "guardians", "student_guardians", "staff", "cards", "devices",
  "attendance", "sms_logs", "school_calendar", "audit_logs",
] as const;

describe.skipIf(!enabled)("Row Level Security", () => {
  let asAdminA: SupabaseClient;
  let asTeacherA: SupabaseClient;
  let asSuper: SupabaseClient;
  let anonClient: SupabaseClient;

  beforeAll(async () => {
    admin = createClient(url!, service!, { auth: { persistSession: false, autoRefreshToken: false } });
    await seedSchool("A");
    await seedSchool("B");
    ids.super = await makeUser(`${tag}-super@example.com`.toLowerCase(), "super_admin", null);
    asAdminA = await signIn(`${tag}-admin-A@example.com`.toLowerCase());
    asTeacherA = await signIn(`${tag}-teacher-A@example.com`.toLowerCase());
    asSuper = await signIn(`${tag}-super@example.com`.toLowerCase());
    anonClient = createClient(url!, anon!, { auth: { persistSession: false } });
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    // Cascades remove every tenant row; then remove the login accounts.
    await admin.from("schools").delete().in("id", [ids.schoolA, ids.schoolB].filter(Boolean));
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id);
  }, 120_000);

  it("school admin A sees only School A rows in every table", async () => {
    for (const table of TENANT_TABLES) {
      const { data, error } = await asAdminA.from(table).select("school_id");
      expect(error, table).toBeNull();
      const schools = new Set((data ?? []).map((r) => r.school_id));
      expect(schools.has(ids.schoolB), `${table} leaked School B`).toBe(false);
      expect(schools.has(ids.schoolA), `${table} should show School A`).toBe(true);
    }
    const { data: schools } = await asAdminA.from("schools").select("id");
    expect(schools?.map((s) => s.id)).toEqual([ids.schoolA]);
    const { data: users } = await asAdminA.from("users").select("school_id");
    expect(users?.every((u) => u.school_id === ids.schoolA)).toBe(true);
  });

  it("school admin A cannot read a School B student even by id", async () => {
    const { data } = await asAdminA.from("students").select("id").eq("id", ids.ownStudentB);
    expect(data).toEqual([]);
  });

  it("school admin A cannot write into School B", async () => {
    const { error } = await asAdminA.from("students").insert({
      school_id: ids.schoolB, admission_no: "HACK", first_name: "x", last_name: "y",
    });
    expect(error).not.toBeNull();
    const { data: updated } = await asAdminA.from("schools").update({ name: "hacked" }).eq("id", ids.schoolB).select();
    expect(updated ?? []).toEqual([]);
  });

  it("school admin cannot read device token hashes", async () => {
    const { error } = await asAdminA.from("devices").select("token_hash");
    expect(error).not.toBeNull();
    const { data, error: e2 } = await asAdminA.from("devices").select("id, name");
    expect(e2).toBeNull();
    expect(data?.length).toBe(1);
  });

  it("users cannot change their own role", async () => {
    const { data } = await asAdminA.from("users").update({ role: "super_admin" }).eq("id", ids.adminA).select();
    expect(data ?? []).toEqual([]);
    const { data: me } = await admin.from("users").select("role").eq("id", ids.adminA).single();
    expect(me?.role).toBe("school_admin");
  });

  it("teacher sees only students and attendance in their own class", async () => {
    const { data: students } = await asTeacherA.from("students").select("id");
    expect(students?.map((s) => s.id)).toEqual([ids.ownStudentA]);
    const { data: att } = await asTeacherA.from("attendance").select("holder_id");
    expect(att?.map((a) => a.holder_id)).toEqual([ids.ownStudentA]);
  });

  it("teacher cannot see guardians, cards, devices, SMS logs or audit logs", async () => {
    for (const table of ["guardians", "student_guardians", "cards", "devices", "sms_logs", "audit_logs"]) {
      const { data } = await asTeacherA.from(table).select("school_id");
      expect(data ?? [], table).toEqual([]);
    }
  });

  it("super admin sees schools and devices but no student records", async () => {
    const { data: schools } = await asSuper.from("schools").select("id").in("id", [ids.schoolA, ids.schoolB]);
    expect(schools?.length).toBe(2);
    for (const table of ["students", "guardians", "student_guardians", "cards", "attendance", "sms_logs"]) {
      const { data } = await asSuper.from(table).select("school_id");
      expect(data ?? [], table).toEqual([]);
    }
  });

  it("anonymous visitors see nothing", async () => {
    for (const table of ["schools", "users", ...TENANT_TABLES]) {
      const { data } = await anonClient.from(table).select("*").limit(1);
      expect(data ?? [], table).toEqual([]);
    }
  });
});
