/**
 * Billing data access against a real Supabase project (throwaway schools, cleaned up).
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
const logins: string[] = [];
const tag = `bill-${Date.now()}`;
const pw = `Bl-${randomUUID()}A1`;

async function login(email: string) {
  const c = createClient(url!, anon!, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: pw });
  if (error) throw error;
  return c;
}

describe.skipIf(!enabled)("billing", () => {
  beforeAll(async () => {
    db = createClient(url!, service!, { auth: { persistSession: false } });
    for (const k of ["A", "B"]) {
      const { data } = await db.from("schools").insert({ name: `Billing ${k} ${tag}`, price_per_student: 500 }).select("id").single();
      ids[k] = data!.id;
      await db.from("students").insert([1, 2, 3].map((n) => ({ school_id: data!.id, admission_no: `${k}${n}`, first_name: "S", last_name: `${n}` })));
      await db.from("invoices").insert({ school_id: data!.id, number: `${tag}-${k}`, period: "2026-10-01", lines: [], total: 1500 });
    }
    await db.from("students").update({ status: "withdrawn" }).eq("school_id", ids.A).eq("admission_no", "A3");
    for (const [role, school] of [["school_admin", ids.A], ["teacher", ids.A]] as const) {
      const email = `${tag}-${role}@example.com`;
      const { data } = await db.auth.admin.createUser({ email, password: pw, email_confirm: true });
      logins.push(data.user!.id);
      await db.from("users").insert({ id: data.user!.id, email, name: role, role, school_id: school });
    }
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    await db.from("invoices").delete().in("school_id", [ids.A, ids.B]);
    await db.from("schools").delete().in("id", [ids.A, ids.B]);
    for (const id of logins) await db.auth.admin.deleteUser(id);
  });

  it("counts active students per school (no names)", async () => {
    const { data } = await db.rpc("school_usage", { p_month: "2026-11-01" });
    const by = new Map((data ?? []).map((r: { school_id: string }) => [r.school_id, r]));
    expect(by.get(ids.A)).toMatchObject({ active_students: 2, sms_sent: 0 });
    expect(by.get(ids.B)).toMatchObject({ active_students: 3 });
  });

  it("a school admin sees only their own invoices, and the seller's details", async () => {
    const admin = await login(`${tag}-school_admin@example.com`);
    const { data } = await admin.from("invoices").select("school_id");
    expect((data ?? []).map((r) => r.school_id)).toEqual([ids.A]);
    const { data: seller } = await admin.from("platform_settings").select("business_name");
    expect(seller).toHaveLength(1);
    // …and can't change them, or call the usage function.
    const { data: changed } = await admin.from("invoices").update({ status: "paid" }).eq("school_id", ids.A).select();
    expect(changed ?? []).toEqual([]);
    const { error } = await admin.rpc("school_usage", { p_month: "2026-11-01" });
    expect(error).not.toBeNull();
  });

  it("teachers see no invoices or billing details", async () => {
    const teacher = await login(`${tag}-teacher@example.com`);
    expect((await teacher.from("invoices").select("id")).data ?? []).toEqual([]);
    expect((await teacher.from("platform_settings").select("id")).data ?? []).toEqual([]);
  });
});
