/**
 * Parent handover at the gate, bus children and late pickup, through the real kiosk route against a real
 * Supabase project (throwaway school, cleaned up). Parent phones are made up, and this machine has no
 * messaging keys, so messages are only saved to the outbox, never sent.
 *   RUN_RLS_TESTS=1 npx vitest run tests/integration/handover.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateDeviceToken, hashDeviceToken } from "@/lib/devices";
import { resetRateLimits } from "@/lib/rate-limit";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = process.env.RUN_RLS_TESTS === "1" && !!url && !!service;

let db: SupabaseClient;
type Handler = (req: NextRequest) => Promise<Response>;
let TAP: Handler;
let expireHandovers: typeof import("@/lib/handover-server").expireHandovers;
let latePickupSweep: typeof import("@/lib/handover-server").latePickupSweep;
const ids: Record<string, string> = {};
const token = generateDeviceToken();
const stamp = Date.now().toString(16).toUpperCase().slice(-8);
const uid = (p: string) => `${p}${stamp}`;
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
const phone = () => `+234809${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;

async function tap(u: string) {
  const res = await TAP(new NextRequest("http://localhost/api/tap", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ uid: u }),
  }));
  return res.json();
}
const sms = async (studentId: string, type?: string) => {
  let q = db.from("sms_logs").select("type, message, guardian_id").eq("student_id", studentId);
  if (type) q = q.eq("type", type);
  return (await q).data ?? [];
};

describe.skipIf(!enabled)("parent handover, bus and late pickup", () => {
  beforeAll(async () => {
    ({ POST: TAP } = await import("@/app/api/tap/route"));
    ({ expireHandovers, latePickupSweep } = await import("@/lib/handover-server"));
    resetRateLimits();
    db = createClient(url!, service!, { auth: { persistSession: false } });
    const ins = async (t: string, row: Record<string, unknown>) => {
      const { data, error } = await db.from(t).insert(row).select("id").single();
      if (error) throw new Error(`${t}: ${error.message}`);
      return data?.id as string;
    };
    // Closing at midnight, so any tap after sign-in is a sign-out; handover switched on.
    ids.school = await ins("schools", { name: `handover-test-${stamp}`, resumption_time: "00:00", closing_time: "00:00", absence_cutoff_time: "00:00", handover_enabled: true, late_pickup_minutes: 30 });
    ids.device = await ins("devices", { school_id: ids.school, name: "Gate", token_hash: hashDeviceToken(token) });
    const student = async (key: string, first: string, transport = "parent") => {
      ids[key] = await ins("students", { school_id: ids.school, admission_no: key, first_name: first, last_name: "Test", transport });
      await ins("cards", { school_id: ids.school, uid: uid(key.slice(0, 2).toUpperCase().replace(/[^0-9A-F]/g, "A")), holder_type: "student", holder_id: ids[key] });
    };
    // Card uids: two hex characters + the stamp. Keys chosen so they map to distinct uids.
    await student("ab", "Kemi"); await student("ac", "Kola"); await student("ad", "Zara");
    await student("ae", "Hana"); await student("af", "Bayo", "bus"); await student("ba", "Lola");
    const parent = async (name: string, kids: string[]) => {
      const g = await ins("guardians", { school_id: ids.school, name, phone: phone() });
      await db.from("student_guardians").insert(kids.map((k) => ({ school_id: ids.school, student_id: ids[k], guardian_id: g })));
      return g;
    };
    ids.mum = await parent("Mrs Test", ["ab", "ac"]);
    ids.mumCard = await ins("pickup_people", { school_id: ids.school, name: "Mrs Test", guardian_id: ids.mum, card_uid: uid("CA") });
    await parent("Mr Zara", ["ad"]); await parent("Mrs Bayo", ["af"]); await parent("Mrs Lola", ["ba"]);
    // Already signed in this morning (no tap of their own today).
    for (const k of ["ae", "af", "ba"]) await ins("attendance", { school_id: ids.school, holder_type: "student", holder_id: ids[k], date: today, sign_in_at: new Date(Date.now() - 3 * 3600_000).toISOString() });
  }, 90_000);

  afterAll(async () => {
    if (db && ids.school) await db.from("schools").delete().eq("id", ids.school);
  });

  it("drop-off: each child taps in and waits; the parent's one tap hands over both, and only that parent is told", async () => {
    const kemi = await tap(uid("AB"));
    expect(kemi).toMatchObject({ action: "signed_in", handover: { kind: "drop_off" } });
    const kola = await tap(uid("AC"));
    expect(kola.action).toBe("signed_in");
    // The arrival message waits for the parent.
    await new Promise((r) => setTimeout(r, 1500));
    expect(await sms(ids.ab!)).toEqual([]);

    const mum = await tap(uid("CA"));
    expect(mum.action).toBe("dropped_off");
    expect((mum.children as { id: string }[]).map((c) => c.id).sort()).toEqual([ids.ab, ids.ac].sort());
    const { data: rows } = await db.from("handovers").select("status, person_id").eq("school_id", ids.school).eq("kind", "drop_off").in("student_id", [ids.ab!, ids.ac!]);
    expect(rows?.every((r) => r.status === "matched" && r.person_id === ids.mumCard)).toBe(true);
    await expect.poll(async () => (await sms(ids.ab!, "dropoff")).length, { timeout: 10_000 }).toBe(1);
    const [msg] = await sms(ids.ab!, "dropoff");
    expect(msg).toMatchObject({ guardian_id: ids.mum, message: expect.stringMatching(/: Kemi Test has checked in at \d{1,2}:\d{2} [AP]M\.$/) });
  });

  it("no parent in time: the child stays signed in, the usual message goes out, and staff see a flag", async () => {
    const zara = await tap(uid("AD"));
    expect(zara.handover).toBeTruthy();
    await db.from("handovers").update({ expires_at: new Date(Date.now() - 1000).toISOString(), started_at: new Date(Date.now() - 130_000).toISOString() }).eq("student_id", ids.ad!).eq("status", "waiting");
    const r = await expireHandovers(db, { schoolId: ids.school });
    expect(r.noParent).toBe(1);
    const { data: h } = await db.from("handovers").select("status").eq("student_id", ids.ad!).single();
    expect(h?.status).toBe("no_parent");
    expect((await sms(ids.ad!)).length).toBe(1); // late or arrival, whichever the school's settings say
    const { data: flags } = await db.from("notifications").select("kind, message").eq("school_id", ids.school).eq("kind", "handover_flag");
    expect(flags?.[0]?.message).toMatch(/^Zara Test signed in at .+, but no parent tapped to hand them over\.$/);
    const { data: att } = await db.from("attendance").select("sign_in_at, sign_out_at").eq("holder_id", ids.ad!).single();
    expect(att?.sign_in_at).not.toBeNull();
    expect(att?.sign_out_at).toBeNull();
  });

  it("a parent-pickup child can't sign out alone", async () => {
    const r = await tap(uid("AE"));
    expect(r).toMatchObject({ action: "held", first_name: "Hana" });
    const { data: att } = await db.from("attendance").select("sign_out_at").eq("holder_id", ids.ae!).single();
    expect(att?.sign_out_at).toBeNull();
    const { data: ev } = await db.from("tap_events").select("result").eq("holder_id", ids.ae!);
    expect(ev?.map((e) => e.result)).toEqual(["held"]);
  });

  it("a bus child taps out alone, and the parent hears they left on the bus", async () => {
    const r = await tap(uid("AF"));
    expect(r.action).toBe("signed_out");
    expect(r.handover).toBeUndefined();
    await expect.poll(async () => (await sms(ids.af!, "bus")).length, { timeout: 10_000 }).toBe(1);
    expect((await sms(ids.af!, "bus"))[0]?.message).toMatch(/: Bayo Test has left school on the bus at \d{1,2}:\d{2} [AP]M\.$/);
  });

  it("late pickup: once, after closing plus the school's minutes, to the parents of children still in school", async () => {
    const at = new Date(`${today}T00:45:00+01:00`); // 45 minutes after a midnight closing, Lagos time
    expect(await latePickupSweep(db, at, ids.school)).toBeGreaterThanOrEqual(1);
    await latePickupSweep(db, at, ids.school);
    const rows = await sms(ids.ba!, "late_pickup");
    expect(rows.length).toBe(1);
    expect(rows[0]!.message).toMatch(/: Lola Test is still at school at 12:45 AM\. School closed at 12:00 AM\./);
    expect(await sms(ids.af!, "late_pickup")).toEqual([]); // bus child, and already signed out
    // Too early: nothing.
    expect(await latePickupSweep(db, new Date(`${today}T00:10:00+01:00`), ids.school)).toBe(0);
  });
});
