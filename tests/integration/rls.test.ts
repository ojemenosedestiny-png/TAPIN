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

  it("card writes only go through the server: no direct inserts or RPC calls", async () => {
    const { error: insErr } = await asAdminA.from("cards").insert({
      school_id: ids.schoolA, uid: "0A0B0C0D", holder_type: "student", holder_id: ids.otherStudentA,
    });
    expect(insErr).not.toBeNull();
    const { error: rpcErr } = await asAdminA.rpc("assign_card", {
      p_school_id: ids.schoolB, p_actor_id: ids.adminA, p_uid: "0A0B0C0D", p_holder_type: "student",
      p_holder_id: ids.ownStudentB, p_confirm_reassign: true,
    });
    expect(rpcErr).not.toBeNull();
  });

  it("overview views respect each table's RLS", async () => {
    const { data: a } = await asAdminA.from("student_overview").select("school_id, guardian_phone");
    expect(a?.every((r) => r.school_id === ids.schoolA)).toBe(true);
    expect(a?.length).toBe(2);
    const { data: t } = await asTeacherA.from("student_overview").select("id, guardian_phone, card_id");
    expect(t?.map((r) => r.id)).toEqual([ids.ownStudentA]);
    expect(t?.[0]?.guardian_phone).toBeNull(); // teachers don't see phone numbers
    expect(t?.[0]?.card_id).toBeNull();
    const { data: s } = await asSuper.from("student_overview").select("id");
    expect(s ?? []).toEqual([]);
  });

  it("photos bucket: admin A cannot upload into School B's folder", async () => {
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
    const { error } = await asAdminA.storage.from("photos").upload(`${ids.schoolB}/student/x-1.jpg`, blob, { contentType: "image/jpeg" });
    expect(error).not.toBeNull();
    const { error: ownErr } = await asAdminA.storage.from("photos").upload(`${ids.schoolA}/student/x-1.jpg`, blob, { contentType: "image/jpeg" });
    expect(ownErr).toBeNull();
    await admin.storage.from("photos").remove([`${ids.schoolA}/student/x-1.jpg`]);
  });

  it("demo requests: only the super admin reads them, and nobody can write them directly", async () => {
    const { data: row } = await admin.from("demo_requests")
      .insert({ name: "RLS Test", school: `RLS Test School ${Date.now()}`, phone: "+2348030000000", pupils: 10 }).select("id").single();
    try {
      const { data: seen } = await asSuper.from("demo_requests").select("id").eq("id", row!.id);
      expect(seen).toHaveLength(1);
      for (const c of [asAdminA, asTeacherA, anonClient]) {
        const { data } = await c.from("demo_requests").select("id").eq("id", row!.id);
        expect(data ?? []).toEqual([]);
        const { error } = await c.from("demo_requests").insert({ name: "Sneaky", school: "Sneaky School", phone: "+2348030000001" });
        expect(error).not.toBeNull();
      }
      const { data: changed } = await asAdminA.from("demo_requests").update({ handled_at: new Date().toISOString() }).eq("id", row!.id).select();
      expect(changed ?? []).toEqual([]);
    } finally {
      await admin.from("demo_requests").delete().eq("id", row!.id);
    }
  });

  it("website orders are for the super admin only; parent payments for that school's admins too", async () => {
    const ref = `TAPIN-SCH-${Date.now().toString(16).toUpperCase().padStart(12, "0").slice(-12)}`;
    const { data: order } = await admin.from("orders").insert({
      reference: ref, plan: "standard", billing: "term", students: 100, school_name: "RLS Order School", contact_name: "Test",
      phone: "+2348030000000", email: "rls@example.com", state: "Lagos", method: "card", amount: 1000,
    }).select("id").single();
    const { data: student } = await admin.from("students").select("id").eq("school_id", ids.schoolA).limit(1).single();
    const { data: pay } = await admin.from("parent_payments").insert({
      reference: ref.replace("SCH", "PAR"), school_id: ids.schoolA, student_id: student!.id, phone: "+2348030000000", amount: 500, method: "card",
    }).select("id").single();
    try {
      expect((await asSuper.from("orders").select("id").eq("id", order!.id)).data).toHaveLength(1);
      for (const c of [asAdminA, asTeacherA, anonClient]) expect((await c.from("orders").select("id").eq("id", order!.id)).data ?? []).toEqual([]);
      expect((await asAdminA.from("parent_payments").select("id").eq("id", pay!.id)).data).toHaveLength(1);
      expect((await asSuper.from("parent_payments").select("id").eq("id", pay!.id)).data).toHaveLength(1);
      for (const c of [asTeacherA, anonClient]) expect((await c.from("parent_payments").select("id").eq("id", pay!.id)).data ?? []).toEqual([]);
      // Nobody marks a payment paid from the browser.
      expect((await asAdminA.from("parent_payments").update({ status: "paid" }).eq("id", pay!.id).select()).data ?? []).toEqual([]);
      const { error } = await anonClient.from("orders").insert({ reference: "X", plan: "starter", billing: "term", students: 1, school_name: "Sneaky", contact_name: "S", phone: "+2348030000001", email: "s@example.com", state: "Lagos", method: "card" });
      expect(error).not.toBeNull();
    } finally {
      await admin.from("parent_payments").delete().eq("id", pay!.id);
      await admin.from("orders").delete().eq("id", order!.id);
    }
  });

  it("attempt counters: only the server can use them; nobody can read or reset them", async () => {
    const key = `test-${Date.now()}-0123456789abcdef`;
    expect((await admin.rpc("rate_limit_hit", { p_key: key, p_max: 2, p_window_seconds: 60 })).data).toBe(true);
    expect((await admin.rpc("rate_limit_hit", { p_key: key, p_max: 2, p_window_seconds: 60 })).data).toBe(true);
    expect((await admin.rpc("rate_limit_hit", { p_key: key, p_max: 2, p_window_seconds: 60 })).data).toBe(false);
    for (const c of [asAdminA, asSuper, anonClient]) {
      const { error } = await c.rpc("rate_limit_hit", { p_key: key, p_max: 1000, p_window_seconds: 1 });
      expect(error).not.toBeNull();
      expect((await c.from("rate_limits").select("key").eq("key", key)).data ?? []).toEqual([]);
      expect((await c.from("rate_limits").delete().eq("key", key).select()).data ?? []).toEqual([]);
    }
    await admin.from("rate_limits").delete().eq("key", key);
  });

  it("anonymous visitors see nothing", async () => {
    for (const table of ["schools", "users", ...TENANT_TABLES]) {
      const { data } = await anonClient.from(table).select("*").limit(1);
      expect(data ?? [], table).toEqual([]);
    }
  });
});
