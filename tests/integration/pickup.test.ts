/**
 * Safe pickup against a real Supabase project (throwaway school, cleaned up).
 *   RUN_RLS_TESTS=1 npx vitest run tests/integration/pickup.test.ts
 * The children have no parents on record, so no SMS is ever sent.
 * Pickup is two taps: the person's card (or a code) opens a window, each child taps, staff confirm.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateDeviceToken, hashDeviceToken } from "@/lib/devices";
import { resetRateLimits } from "@/lib/rate-limit";
import { hashPickupCode, hashQrToken } from "@/lib/pickup";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = process.env.RUN_RLS_TESTS === "1" && !!url && !!service;

let db: SupabaseClient;
type Handler = (req: NextRequest) => Promise<Response>;
let TAP: Handler, PICKUP: Handler, CODE: Handler, QR: Handler;
const ids: Record<string, string> = {};
const token = generateDeviceToken();
const stamp = Date.now().toString(16).toUpperCase().slice(-8);
const UID = `0D${stamp}`.padEnd(10, "0");
const ADA = `0E${stamp}`, TOLU = `0F${stamp}`, FEMI = `1A${stamp}`;
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
    ({ POST: QR } = await import("@/app/api/pickup/qr/route"));
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
    ids.femi = await ins("students", { school_id: ids.school, class_id: ids.class, admission_no: "P-3", first_name: "Femi", last_name: "Ade" });
    for (const [uid, sid] of [[ADA, ids.ada], [TOLU, ids.tolu], [FEMI, ids.femi]] as const) await ins("cards", { school_id: ids.school, uid, holder_type: "student", holder_id: sid });
    ids.device = await ins("devices", { school_id: ids.school, name: "Gate", token_hash: hashDeviceToken(token) });
    for (const sid of [ids.ada, ids.femi]) await ins("attendance", { school_id: ids.school, holder_type: "student", holder_id: sid, date: today, sign_in_at: new Date(Date.now() - 3600_000).toISOString() });
    ids.person = await ins("pickup_people", { school_id: ids.school, name: "Ngozi Obi", relationship: "Aunt", card_uid: UID });
    await db.from("pickup_people_students").insert([
      { person_id: ids.person, student_id: ids.ada, school_id: ids.school },
      { person_id: ids.person, student_id: ids.tolu, school_id: ids.school },
    ]);
  }, 60_000);

  afterAll(async () => {
    if (db && ids.school) await db.from("schools").delete().eq("id", ids.school);
  });

  let windowId = "";

  it("a pickup card opens a window showing the person and their children, with who is in school", async () => {
    const r = await call(TAP, "/api/tap", { uid: UID });
    expect(r.body).toMatchObject({ action: "pickup", picker: { name: "Ngozi Obi", relationship: "Aunt" } });
    const states = Object.fromEntries((r.body.children as { id: string; state: string; matched: boolean }[]).map((c) => [c.id, [c.state, c.matched]]));
    expect(states).toEqual({ [ids.ada]: ["in_school", false], [ids.tolu]: ["not_in", false] });
    windowId = r.body.handover_id;
    expect(windowId).toBeTruthy();
  });

  it("a linked child taps and is matched; one not in school is noted; one not linked is refused and the office told", async () => {
    const notIn = await call(TAP, "/api/tap", { uid: TOLU });
    expect(notIn.body).toMatchObject({ action: "pickup", notice: "Tolu isn't signed in today." });
    const stranger = await call(TAP, "/api/tap", { uid: FEMI });
    expect(stranger.body).toMatchObject({ action: "pickup_refused", name: "Ngozi Obi", child: "Femi Ade" });
    const { data: refused } = await db.from("handovers").select("status, student_id").eq("window_id", windowId).eq("status", "refused");
    expect(refused).toEqual([{ status: "refused", student_id: ids.femi }]);
    await expect.poll(async () => (await db.from("notifications").select("kind").eq("school_id", ids.school).eq("kind", "pickup_denied")).data?.length, { timeout: 10_000 }).toBe(1);
    const { data: femi } = await db.from("attendance").select("sign_out_at").eq("holder_id", ids.femi).single();
    expect(femi?.sign_out_at).toBeNull();

    // The window survives the refusal; the right child is matched.
    const ok = await call(TAP, "/api/tap", { uid: ADA });
    expect(ok.body.action).toBe("pickup");
    expect((ok.body.children as { id: string; matched: boolean }[]).find((c) => c.id === ids.ada)?.matched).toBe(true);
  });

  it("staff confirm releases only the matched children, once", async () => {
    const r = await call(PICKUP, "/api/pickup", { handover_id: windowId });
    expect(r.body).toMatchObject({ action: "picked_up", name: "Ngozi Obi", children: [{ id: ids.ada }] });
    const { data: att } = await db.from("attendance").select("sign_out_at, picked_up_by").eq("holder_id", ids.ada).single();
    expect(att?.picked_up_by).toBe("Ngozi Obi");
    expect(att?.sign_out_at).not.toBeNull();
    const { data: ev } = await db.from("pickup_events").select("kind, student_id").eq("school_id", ids.school).eq("kind", "picked_up");
    expect(ev).toEqual([{ kind: "picked_up", student_id: ids.ada }]);
    const { data: h } = await db.from("handovers").select("status").eq("id", windowId).single();
    expect(h?.status).toBe("confirmed");
    // Same confirmation again: nothing more happens.
    expect((await call(PICKUP, "/api/pickup", { handover_id: windowId })).status).toBe(409);
  });

  it("a stopped person gets Not authorised, and it is logged", async () => {
    await db.from("pickup_people").update({ status: "revoked" }).eq("id", ids.person);
    const r = await call(TAP, "/api/tap", { uid: UID });
    expect(r.body).toMatchObject({ action: "not_authorised", name: "Ngozi Obi" });
    expect(r.body.children).toBeUndefined();
    const { data } = await db.from("pickup_events").select("kind").eq("school_id", ids.school).eq("kind", "not_authorised").neq("student_id", ids.femi);
    expect(data?.length).toBe(2); // one per linked child (Femi's refusal earlier is logged separately)
  });

  it("a one-day code opens a window for its own children only, and works once", async () => {
    const { data: code } = await db.from("pickup_codes").insert({ school_id: ids.school, code_hash: hashPickupCode(ids.school, "482915"), person_name: "Mr Bello", valid_date: today }).select("id").single();
    await db.from("pickup_code_students").insert({ code_id: code!.id, student_id: ids.tolu, school_id: ids.school });
    await db.from("attendance").insert({ school_id: ids.school, holder_type: "student", holder_id: ids.tolu, date: today, sign_in_at: new Date(Date.now() - 1800_000).toISOString() });

    expect((await call(CODE, "/api/pickup/code", { code: "111111" })).status).toBe(404);
    const offer = await call(CODE, "/api/pickup/code", { code: "482 915" });
    expect(offer.body).toMatchObject({ action: "pickup", picker: { name: "Mr Bello" } });
    expect((offer.body.children as { id: string }[]).map((c) => c.id)).toEqual([ids.tolu]);
    expect((await call(PICKUP, "/api/pickup", { handover_id: offer.body.handover_id })).status).toBe(400); // no child has tapped
    expect((await call(TAP, "/api/tap", { uid: FEMI })).body.action).toBe("pickup_refused");
    expect((await call(TAP, "/api/tap", { uid: TOLU })).body.action).toBe("pickup");
    expect((await call(PICKUP, "/api/pickup", { handover_id: offer.body.handover_id })).body.action).toBe("picked_up");
    expect((await call(CODE, "/api/pickup/code", { code: "482915" })).status).toBe(404);
  });

  it("locks code entry after five wrong codes and tells the office", async () => {
    // The right code reset the count; the used 482915 was wrong number one. Three more, then the fifth locks.
    for (const c of ["222222", "333333", "444444"]) expect((await call(CODE, "/api/pickup/code", { code: c })).status).toBe(404);
    const fifth = await call(CODE, "/api/pickup/code", { code: "555555" });
    expect(fifth.status).toBe(423);
    expect((await call(CODE, "/api/pickup/code", { code: "482915" })).status).toBe(423); // even a real code waits
    const { data } = await db.from("notifications").select("kind").eq("school_id", ids.school).eq("kind", "code_lock");
    expect(data?.length).toBe(1);
    await db.from("devices").update({ code_locked_until: null, code_failures: 0 }).eq("id", ids.device);
  });

  it("a QR pass works like the card, and a stopped person's pass is refused", async () => {
    const token = "Qr_" + "x".repeat(32);
    await db.from("pickup_people").update({ status: "active", qr_token_hash: hashQrToken(token) }).eq("id", ids.person);
    const ok = await call(QR, "/api/pickup/qr", { text: `TAPIN-P:${token}` });
    expect(ok.body).toMatchObject({ action: "pickup", picker: { name: "Ngozi Obi" } });
    expect((await call(QR, "/api/pickup/qr", { text: "TAPIN-P:" + "y".repeat(35) })).body.action).toBe("not_authorised");
    expect((await call(QR, "/api/pickup/qr", { text: "hello" })).status).toBe(400);
    await db.from("pickup_people").update({ status: "revoked" }).eq("id", ids.person);
    expect((await call(QR, "/api/pickup/qr", { text: `TAPIN-P:${token}` })).body.action).toBe("not_authorised");
  });

  it("a pickup card can't also be linked as a student card", async () => {
    const { error } = await db.from("cards").insert({ school_id: ids.school, uid: UID, holder_type: "student", holder_id: ids.ada });
    expect(error).not.toBeNull();
  });
});
