/**
 * Step 1 data model: handovers, bus/parent transport, parent absence and early-pickup records, the
 * notification kinds, and pricing/subscriptions (super admin only). Throwaway schools, users and price
 * rows; everything made here is deleted at the end. Seeded prices are never changed.
 *   RUN_RLS_TESTS=1 npx vitest run tests/integration/step1-datamodel.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = process.env.RUN_RLS_TESTS === "1" && !!url && !!anon && !!service;

const tag = `step1-${Date.now()}`;
const password = `T3st-${randomUUID()}`;
const ids: Record<string, string> = {};
const users: string[] = [];
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
let db: SupabaseClient;

async function ins(table: string, row: Record<string, unknown>, key = "id") {
  const { data, error } = await db.from(table).insert(row).select(key).single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data as unknown as Record<string, string>)[key]!;
}
async function makeUser(email: string, role: "super_admin" | "school_admin" | "teacher", schoolId: string | null) {
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  users.push(data.user.id);
  const { error: e2 } = await db.from("users").insert({ id: data.user.id, school_id: schoolId, name: email, email, role });
  if (e2) throw e2;
  return data.user.id;
}
async function signIn(email: string) {
  const c = createClient(url!, anon!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return c;
}

describe.skipIf(!enabled)("step 1 data model", () => {
  let adminA: SupabaseClient, teacherA: SupabaseClient, superA: SupabaseClient;

  beforeAll(async () => {
    db = createClient(url!, service!, { auth: { persistSession: false } });
    ids.A = await ins("schools", { name: `${tag} A` });
    ids.B = await ins("schools", { name: `${tag} B` });
    ids.ada = await ins("students", { school_id: ids.A, admission_no: "S1-1", first_name: "Ada", last_name: "Obi" });
    ids.bola = await ins("students", { school_id: ids.B, admission_no: "S1-2", first_name: "Bola", last_name: "Ade", transport: "bus" });
    ids.mum = await ins("guardians", { school_id: ids.A, name: "Ngozi Obi", phone: "+2348090000001" });
    ids.mumCard = await ins("pickup_people", { school_id: ids.A, name: "Ngozi Obi", guardian_id: ids.mum, card_uid: `0A${Date.now().toString(16).toUpperCase().slice(-10)}` });
    ids.kioskA = await ins("devices", { school_id: ids.A, name: "Gate", token_hash: `${tag}-a` });
    ids.adminA = await makeUser(`${tag}-admin@example.com`, "school_admin", ids.A);
    await makeUser(`${tag}-teacher@example.com`, "teacher", ids.A);
    ids.super = await makeUser(`${tag}-super@example.com`, "super_admin", null);
    adminA = await signIn(`${tag}-admin@example.com`);
    teacherA = await signIn(`${tag}-teacher@example.com`);
    superA = await signIn(`${tag}-super@example.com`);
  }, 90_000);

  afterAll(async () => {
    if (!db) return;
    for (const k of ["A", "B"]) if (ids[k]) await db.from("schools").delete().eq("id", ids[k]);
    if (ids.item) { await db.from("price_items").delete().eq("id", ids.item); await db.from("price_history").delete().eq("entity_id", ids.item); }
    if (ids.plan) { await db.from("subscription_plans").delete().eq("id", ids.plan); await db.from("price_history").delete().eq("entity_id", ids.plan); }
    if (ids.A) await db.from("price_history").delete().eq("entity_id", ids.A);
    for (const u of users) await db.auth.admin.deleteUser(u);
  });

  it("students are parent pickup by default, bus when set, and nothing else", async () => {
    const { data } = await db.from("students").select("id, transport").in("id", [ids.ada, ids.bola]).order("first_name");
    expect(data?.map((s) => s.transport)).toEqual(["parent", "bus"]);
    const { error } = await db.from("students").update({ transport: "car" }).eq("id", ids.ada!);
    expect(error?.code).toBe("23514");
  });

  it("a parent has at most one card record", async () => {
    const { error } = await db.from("pickup_people").insert({ school_id: ids.A, name: "Ngozi again", guardian_id: ids.mum });
    expect(error?.code).toBe("23505");
  });

  it("keeps one open pickup window per kiosk (siblings may wait together at drop-off), and never mixes schools", async () => {
    const window = { started_at: new Date().toISOString(), expires_at: new Date(Date.now() + 120_000).toISOString() };
    ids.h1 = await ins("handovers", { school_id: ids.A, kind: "drop_off", date: today, student_id: ids.ada, device_id: ids.kioskA, ...window });
    ids.w1 = await ins("handovers", { school_id: ids.A, kind: "pick_up", date: today, person_id: ids.mumCard, device_id: ids.kioskA, ...window });
    const second = await db.from("handovers").insert({ school_id: ids.A, kind: "pick_up", date: today, person_id: ids.mumCard, device_id: ids.kioskA, ...window });
    expect(second.error?.code).toBe("23505");
    const crossed = await db.from("handovers").insert({ school_id: ids.A, kind: "drop_off", date: today, student_id: ids.bola, ...window });
    expect(crossed.error?.message).toMatch(/another school/);
    // Closing the window frees the kiosk for the next one.
    await db.from("handovers").update({ status: "confirmed", completed_at: new Date().toISOString() }).eq("id", ids.w1!);
    const { error } = await db.from("handovers").insert({ school_id: ids.A, kind: "pick_up", date: today, person_id: ids.mumCard, device_id: ids.kioskA, ...window });
    expect(error).toBeNull();
  });

  it("lets the school admin see their own handovers and early pickup requests, and teachers neither", async () => {
    await ins("early_pickup_requests", { school_id: ids.A, student_id: ids.ada, guardian_id: ids.mum, date: today, at_time: "12:00", note: "Dentist" });
    const crossed = await db.from("early_pickup_requests").insert({ school_id: ids.A, student_id: ids.bola, date: today });
    expect(crossed.error?.message).toMatch(/another school/);
    expect((await adminA.from("handovers").select("id")).data?.length).toBe(3);
    expect((await adminA.from("early_pickup_requests").select("note")).data).toEqual([{ note: "Dentist" }]);
    expect((await teacherA.from("handovers").select("id")).data ?? []).toHaveLength(0);
    expect((await teacherA.from("early_pickup_requests").select("id")).data ?? []).toHaveLength(0);
  });

  it("records absences a parent reports, and accepts the notices the app writes", async () => {
    await ins("excusals", { school_id: ids.A, student_id: ids.ada, date: today, reason: "Sick: fever", guardian_id: ids.mum, source: "whatsapp" });
    for (const kind of ["pickup_denied", "emergency", "handover_flag", "early_pickup", "code_lock", "renewal_due"]) {
      const { error } = await db.from("notifications").insert({ school_id: ids.A, kind, message: "test", dedupe_key: `${tag}-${kind}` });
      expect(error, kind).toBeNull();
    }
  });

  it("seeds setup items and plans at ₦0, switched off, so no price is ever hard-coded", async () => {
    const { data: items } = await db.from("price_items").select("name, unit_price, active").order("sort");
    for (const n of ["Kiosk setup", "Standard NFC card", "Premium NFC wristband", "Replacement card", "Replacement wristband"]) {
      expect(items?.some((i) => i.name === n), n).toBe(true);
    }
    const { data: plans } = await db.from("subscription_plans").select("name").order("sort");
    expect(plans?.map((p) => p.name)).toEqual(expect.arrayContaining(["Starter", "Standard", "Premium"]));
  });

  it("shows pricing to the super admin only", async () => {
    for (const t of ["price_items", "subscription_plans", "price_history", "subscriptions", "quotes"]) {
      expect((await adminA.from(t).select("*").limit(1)).data ?? [], `${t} school admin`).toHaveLength(0);
      expect((await teacherA.from(t).select("*").limit(1)).data ?? [], `${t} teacher`).toHaveLength(0);
    }
    expect(((await superA.from("price_items").select("id")).data ?? []).length).toBeGreaterThanOrEqual(5);
    // Nobody writes pricing from a browser session (writes go through the server after a super-admin check).
    expect((await adminA.from("price_items").insert({ name: "Hack", unit_price: 1 })).error).not.toBeNull();
    expect((await superA.from("price_items").insert({ name: `${tag} browser`, unit_price: 1 })).error).not.toBeNull();
  });

  it("logs every price change with who made it", async () => {
    ids.item = await ins("price_items", { name: `${tag} lanyard`, unit: "per lanyard", unit_price: 500, updated_by: ids.super });
    await db.from("price_items").update({ unit_price: 650, active: true, updated_by: ids.super }).eq("id", ids.item!);
    const { data } = await db.from("price_history").select("field, old_value, new_value, changed_by").eq("entity_id", ids.item!).order("id");
    expect(data).toEqual([
      { field: "created", old_value: null, new_value: "500.00", changed_by: ids.super },
      { field: "unit_price", old_value: "500.00", new_value: "650.00", changed_by: ids.super },
      { field: "active", old_value: "false", new_value: "true", changed_by: ids.super },
    ]);
  });

  it("keeps a school's agreed price when the plan price changes, and shows the admin only plan, date and status", async () => {
    ids.plan = await ins("subscription_plans", { name: `${tag} plan`, min_students: 0, max_students: 100, monthly_price: 50000, active: true, updated_by: ids.super });
    const renews = new Date(Date.now() + 3 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
    await db.from("subscriptions").insert({ school_id: ids.A, plan_id: ids.plan, agreed_monthly_price: 50000, started_on: today, renews_on: renews, updated_by: ids.super });
    await db.from("subscription_plans").update({ monthly_price: 65000, updated_by: ids.super }).eq("id", ids.plan!);
    const { data: sub } = await db.from("subscriptions").select("agreed_monthly_price").eq("school_id", ids.A!).single();
    expect(Number(sub!.agreed_monthly_price)).toBe(50000);

    const { data: mine } = await adminA.rpc("my_subscription");
    expect(mine).toEqual([{ plan_name: `${tag} plan`, renews_on: renews, status: "due" }]);
    expect(Object.keys((mine as Record<string, unknown>[])[0]!)).not.toContain("agreed_monthly_price");
    expect((await teacherA.rpc("my_subscription")).data ?? []).toHaveLength(0);

    const { data: st } = await db.rpc("subscription_status", { p_renews_on: "2026-01-01", p_suspended: false, p_today: "2026-02-01" });
    expect(st).toBe("overdue");
  });
});
