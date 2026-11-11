/**
 * Safe pickup against a real Supabase project (throwaway school, cleaned up).
 *   RUN_RLS_TESTS=1 npx vitest run tests/integration/pickup.test.ts
 * The children have no parents on record, so no SMS is ever sent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateDeviceToken, hashDeviceToken } from "@/lib/devices";
import { resetRateLimits } from "@/lib/rate-limit";
import { hashPickupCode } from "@/lib/pickup";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = process.env.RUN_RLS_TESTS === "1" && !!url && !!service;

let db: SupabaseClient;
type Handler = (req: NextRequest) => Promise<Response>;
let TAP: Handler, PICKUP: Handler, CODE: Handler;
const ids: Record<string, string> = {};
const token = generateDeviceToken();
const UID = `0D${Date.now().toString(16).toUpperCase().slice(-8)}`.padEnd(10, "0");
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

async function call(h: Handler, path: string, body: Record<string, unknown>) {
  const res = await h(new NextRequest(`http://localhost${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
}

describe.skipIf(!enabled)("safe pickup", () => {
  beforeAll(async () => {
    ({ POST: TAP } = await import("@/app/api/tap/route"));
    ({ POST: PICKUP } = await import("@/app/api/pickup/route"));
    ({ POST: CODE } = await import("@/app/api/pickup/code/route"));
    resetRateLimits();
    db = createClient(url!, service!, { auth: { persistSession: false } });
    const ins = async (t: string, row: Record<string, unknown>) => {
      const { data, error } = await db.from(t).insert(row).select("id").single();
      if (error) throw new Error(`${t}: ${error.message}`);
      return data?.id as string;
    };
    ids.school = await ins("schools", { name: `pickup-test-${Date.now()}`, resumption_time: "00:00", closing_time: "23:59", absence_cutoff_time: "23:58" });
    ids.class = await ins("classes", { school_id: ids.school, name: "P3" });
    ids.ada = await ins("students", { school_id: ids.school, class_id: ids.class, admission_no: "P-1", first_name: "Ada", last_name: "Obi" });
    ids.tolu = await ins("students", { school_id: ids.school, class_id: ids.class, admission_no: "P-2", first_name: "Tolu", last_name: "Obi" });
    ids.device = await ins("devices", { school_id: ids.school, name: "Gate", token_hash: hashDeviceToken(token) });
    await ins("attendance", { school_id: ids.school, holder_type: "student", holder_id: ids.ada, date: today, sign_in_at: new Date(Date.now() - 3600_000).toISOString() });
    ids.person = await ins("pickup_people", { school_id: ids.school, name: "Ngozi Obi", relationship: "Aunt", card_uid: UID });
    await db.from("pickup_people_students").insert([
      { person_id: ids.person, student_id: ids.ada, school_id: ids.school },
      { person_id: ids.person, student_id: ids.tolu, school_id: ids.school },
    ]);
  }, 60_000);

  afterAll(async () => {
    if (db && ids.school) await db.from("schools").delete().eq("id", ids.school);
  });

  let tapId = 0;

  it("a pickup card shows the person and their children, with who is in school", async () => {
    const r = await call(TAP, "/api/tap", { uid: UID });
    expect(r.body).toMatchObject({ action: "pickup", picker: { name: "Ngozi Obi", relationship: "Aunt" } });
    const states = Object.fromEntries((r.body.children as { id: string; state: string }[]).map((c) => [c.id, c.state]));
    expect(states).toEqual({ [ids.ada]: "in_school", [ids.tolu]: "not_in" });
    tapId = r.body.tap_id;
  });

  it("only releases children who are in school and linked to this person", async () => {
    expect((await call(PICKUP, "/api/pickup", { tap_id: tapId, student_ids: [ids.tolu] })).status).toBe(409);
    const r = await call(PICKUP, "/api/pickup", { tap_id: tapId, student_ids: [ids.ada] });
    expect(r.body).toMatchObject({ action: "picked_up", name: "Ngozi Obi" });
    const { data: att } = await db.from("attendance").select("sign_out_at, picked_up_by").eq("holder_id", ids.ada).single();
    expect(att?.picked_up_by).toBe("Ngozi Obi");
    expect(att?.sign_out_at).not.toBeNull();
    const { data: ev } = await db.from("pickup_events").select("kind, student_id").eq("school_id", ids.school);
    expect(ev).toEqual([{ kind: "picked_up", student_id: ids.ada }]);
    // Same confirmation again: nothing more happens.
    expect((await call(PICKUP, "/api/pickup", { tap_id: tapId, student_ids: [ids.ada] })).status).toBe(409);
  });

  it("a stopped person gets Not authorised, and it is logged", async () => {
    await db.from("pickup_people").update({ status: "revoked" }).eq("id", ids.person);
    const r = await call(TAP, "/api/tap", { uid: UID });
    expect(r.body).toMatchObject({ action: "not_authorised", name: "Ngozi Obi" });
    expect(r.body.children).toBeUndefined();
    const { data } = await db.from("pickup_events").select("kind").eq("school_id", ids.school).eq("kind", "not_authorised");
    expect(data?.length).toBe(2); // one per linked child
  });

  it("a one-day code works once, for its own children only", async () => {
    const { data: code } = await db.from("pickup_codes").insert({ school_id: ids.school, code_hash: hashPickupCode(ids.school, "482915"), person_name: "Mr Bello", valid_date: today }).select("id").single();
    await db.from("pickup_code_students").insert({ code_id: code!.id, student_id: ids.tolu, school_id: ids.school });
    await db.from("attendance").insert({ school_id: ids.school, holder_type: "student", holder_id: ids.tolu, date: today, sign_in_at: new Date(Date.now() - 1800_000).toISOString() });

    expect((await call(CODE, "/api/pickup/code", { code: "111111" })).status).toBe(404);
    const offer = await call(CODE, "/api/pickup/code", { code: "482 915" });
    expect(offer.body).toMatchObject({ action: "pickup", picker: { name: "Mr Bello" } });
    expect((offer.body.children as { id: string }[]).map((c) => c.id)).toEqual([ids.tolu]);
    expect((await call(PICKUP, "/api/pickup", { tap_id: offer.body.tap_id, student_ids: [ids.ada] })).status).toBe(400);
    expect((await call(PICKUP, "/api/pickup", { tap_id: offer.body.tap_id, student_ids: [ids.tolu] })).body.action).toBe("picked_up");
    expect((await call(CODE, "/api/pickup/code", { code: "482915" })).status).toBe(404);
  });

  it("a pickup card can't also be linked as a student card", async () => {
    const { error } = await db.from("cards").insert({ school_id: ids.school, uid: UID, holder_type: "student", holder_id: ids.ada });
    expect(error).not.toBeNull();
  });
});
