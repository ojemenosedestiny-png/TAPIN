/**
 * Emergency roll call against a real Supabase project (throwaway school, cleaned up). No SMS is sent.
 *   RUN_RLS_TESTS=1 npx vitest run tests/integration/emergency.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateDeviceToken, hashDeviceToken } from "@/lib/devices";
import { resetRateLimits } from "@/lib/rate-limit";
import { hashPin } from "@/lib/emergency";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = process.env.RUN_RLS_TESTS === "1" && !!url && !!service;

let db: SupabaseClient;
type Handler = (req: NextRequest) => Promise<Response>;
let TAP: Handler, EM_POST: Handler, EM_GET: Handler;
const ids: Record<string, string> = {};
const token = generateDeviceToken();
const stamp = Date.now().toString(16).toUpperCase().slice(-8);
const UID_ADA = `0E${stamp}`.padEnd(10, "0");
const UID_LATE = `0F${stamp}`.padEnd(10, "0");
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

const req = (path: string, body?: Record<string, unknown>) => new NextRequest(`http://localhost${path}`, {
  method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
});
const json = async (r: Promise<Response>) => { const res = await r; return { status: res.status, body: await res.json() }; };

describe.skipIf(!enabled)("emergency roll call", () => {
  beforeAll(async () => {
    ({ POST: TAP } = await import("@/app/api/tap/route"));
    ({ POST: EM_POST, GET: EM_GET } = await import("@/app/api/emergency/route"));
    resetRateLimits();
    db = createClient(url!, service!, { auth: { persistSession: false } });
    const ins = async (t: string, row: Record<string, unknown>) => {
      const { data, error } = await db.from(t).insert(row).select("id").single();
      if (error) throw new Error(`${t}: ${error.message}`);
      return data?.id as string;
    };
    ids.school = await ins("schools", { name: `emergency-test-${Date.now()}`, resumption_time: "00:00", closing_time: "23:59", absence_cutoff_time: "23:58" });
    ids.class = await ins("classes", { school_id: ids.school, name: "JSS1" });
    ids.ada = await ins("students", { school_id: ids.school, class_id: ids.class, admission_no: "E-1", first_name: "Ada", last_name: "Obi" });
    ids.bayo = await ins("students", { school_id: ids.school, class_id: ids.class, admission_no: "E-2", first_name: "Bayo", last_name: "Ade" });
    ids.late = await ins("students", { school_id: ids.school, class_id: ids.class, admission_no: "E-3", first_name: "Chi", last_name: "Eze" });
    await ins("cards", { school_id: ids.school, uid: UID_ADA, holder_type: "student", holder_id: ids.ada });
    await ins("cards", { school_id: ids.school, uid: UID_LATE, holder_type: "student", holder_id: ids.late });
    ids.device = await ins("devices", { school_id: ids.school, name: "Field", token_hash: hashDeviceToken(token) });
    const signedIn = new Date(Date.now() - 3600_000).toISOString();
    await db.from("attendance").insert([
      { school_id: ids.school, holder_type: "student", holder_id: ids.ada, date: today, sign_in_at: signedIn },
      { school_id: ids.school, holder_type: "student", holder_id: ids.bayo, date: today, sign_in_at: signedIn },
    ]);
    await db.from("emergency_settings").insert({ school_id: ids.school, pin_hash: hashPin("4821") });
  }, 60_000);

  afterAll(async () => {
    if (db && ids.school) await db.from("schools").delete().eq("id", ids.school);
  });

  it("is locked on Basic", async () => {
    expect((await json(EM_GET(req("/api/emergency")))).body).toEqual({ available: false, active: null });
    expect((await json(EM_POST(req("/api/emergency", { pin: "4821" })))).status).toBe(403);
  });

  it("on Premium, a wrong PIN is refused and the right one starts the roll call", async () => {
    await db.from("schools").update({ plan: "premium" }).eq("id", ids.school);
    expect((await json(EM_POST(req("/api/emergency", { pin: "0000" })))).status).toBe(401);
    const r = await json(EM_POST(req("/api/emergency", { pin: "4821", kind: "drill" })));
    expect(r.status).toBe(200);
    expect(r.body.active).toMatchObject({ kind: "drill", counts: { total: 2, safe: 0, missing: 2 } });
  });

  it("a tap marks the person safe instead of signing them in or out", async () => {
    const r = await json(TAP(req("/api/tap", { uid: UID_ADA })));
    expect(r.body).toMatchObject({ action: "safe", name: "Ada Obi", counts: { total: 2, safe: 1, missing: 1 } });
    const { data } = await db.from("attendance").select("sign_out_at").eq("holder_id", ids.ada).single();
    expect(data?.sign_out_at).toBeNull();
  });

  it("someone who wasn't tapped in is added to the roll as safe", async () => {
    const r = await json(TAP(req("/api/tap", { uid: UID_LATE })));
    expect(r.body).toMatchObject({ action: "safe", counts: { total: 3, safe: 2, missing: 1 } });
    const { data } = await db.from("emergency_people").select("on_roster").eq("holder_id", ids.late).single();
    expect(data?.on_roster).toBe(false);
  });

  it("after it ends, taps work normally again", async () => {
    await db.from("emergencies").update({ ended_at: new Date().toISOString() }).eq("school_id", ids.school);
    expect((await json(EM_GET(req("/api/emergency")))).body.active).toBeNull();
    const r = await json(TAP(req("/api/tap", { uid: UID_ADA })));
    expect(r.body.action).not.toBe("safe");
  });
});
