/**
 * School portal link against a real Supabase project (throwaway schools and users, cleaned up).
 * The kiosk key must never be readable from a browser session; each school sees only its own link.
 * No request goes to a real portal: sending uses a fake fetch.
 *   RUN_RLS_TESTS=1 npx vitest run tests/integration/portal-link.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { processPortalDeliveries, queuePortalTap } from "@/lib/portal-link";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = process.env.RUN_RLS_TESTS === "1" && !!url && !!anon && !!service;

const tag = `portal-test-${Date.now()}`;
const password = `T3st-${randomUUID()}`;
const ids: Record<string, string> = {};
const users: string[] = [];
let db: SupabaseClient;

async function makeUser(email: string, role: "school_admin" | "teacher", schoolId: string) {
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  users.push(data.user.id);
  const { error: e2 } = await db.from("users").insert({ id: data.user.id, school_id: schoolId, name: email, email, role });
  if (e2) throw e2;
}
async function signIn(email: string) {
  const c = createClient(url!, anon!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return c;
}

describe.skipIf(!enabled)("school portal link", () => {
  let adminA: SupabaseClient;
  let teacherA: SupabaseClient;

  beforeAll(async () => {
    db = createClient(url!, service!, { auth: { persistSession: false } });
    for (const k of ["A", "B"]) {
      const { data, error } = await db.from("schools").insert({ name: `${tag} School ${k}` }).select("id").single();
      if (error) throw error;
      ids[k] = data.id as string;
      const { error: e } = await db.from("portal_links").insert({ school_id: data.id, url: `https://portal-${k.toLowerCase()}.example.com/api/kiosk/tap`, api_key: `nwek_secret_${k}_${randomUUID()}`, key_tail: "abcd" });
      if (e) throw e;
    }
    const { data: st, error: se } = await db.from("students").insert({ school_id: ids.A, admission_no: "P-1", first_name: "Ada", last_name: "Obi" }).select("id").single();
    if (se) throw se;
    ids.student = st.id as string;
    await makeUser(`${tag}-admin@example.com`, "school_admin", ids.A!);
    await makeUser(`${tag}-teacher@example.com`, "teacher", ids.A!);
    adminA = await signIn(`${tag}-admin@example.com`);
    teacherA = await signIn(`${tag}-teacher@example.com`);
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    for (const k of ["A", "B"]) if (ids[k]) await db.from("schools").delete().eq("id", ids[k]);
    for (const u of users) await db.auth.admin.deleteUser(u);
  });

  it("lets an admin see their own link, but never the key", async () => {
    const { data, error } = await adminA.from("portal_links").select("school_id, url, key_tail, match_by, enabled");
    expect(error).toBeNull();
    expect(data?.map((r) => r.school_id)).toEqual([ids.A]);
    const key = await adminA.from("portal_links").select("api_key");
    expect(key.error).not.toBeNull();
    expect(key.data).toBeNull();
    const all = await adminA.from("portal_links").select("*");
    expect(all.data ?? []).toHaveLength(0);
  });

  it("doesn't let a browser session change the link", async () => {
    await adminA.from("portal_links").update({ url: "https://evil.example.com/x" }).eq("school_id", ids.A!);
    await adminA.from("portal_links").insert({ school_id: ids.B, url: "https://evil.example.com/x", api_key: "nwek_attacker1", key_tail: "ker1" });
    await adminA.from("portal_links").delete().eq("school_id", ids.B!);
    const { data } = await db.from("portal_links").select("school_id, url").in("school_id", [ids.A, ids.B]).order("url");
    expect(data?.map((r) => r.url)).toEqual(["https://portal-a.example.com/api/kiosk/tap", "https://portal-b.example.com/api/kiosk/tap"]);
  });

  it("hides the link from teachers", async () => {
    const { data } = await teacherA.from("portal_links").select("school_id, url");
    expect(data ?? []).toHaveLength(0);
  });

  it("queues a sign-in once, sends it with the school's own key, and records the portal's answer", async () => {
    const tapEventId = Math.floor(Math.random() * 1e12) + 1e12;
    const t = { schoolId: ids.A!, studentId: ids.student!, tapEventId, cardUid: "04A1B2C3", admissionNo: "P-1", tappedAt: new Date() };
    expect(await queuePortalTap(db, t)).toBe(true);
    expect(await queuePortalTap(db, t)).toBe(false); // the same tap twice: queued once

    const fake = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: "present", message: "Welcome, Ada. Marked present at 07:42." }), { status: 200 })) as unknown as typeof fetch;
    const r = await processPortalDeliveries(db, { schoolId: ids.A, fetchImpl: fake });
    expect(r.sent).toBe(1);
    const [calledUrl, init] = (fake as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(calledUrl).toBe("https://portal-a.example.com/api/kiosk/tap");
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer nwek_secret_A_/);
    expect(JSON.parse(init.body as string)).toMatchObject({ cardId: "04A1B2C3", tapId: `tapin-${tapEventId}` });

    const { data: row } = await adminA.from("portal_deliveries").select("status, result, message").eq("tap_event_id", tapEventId).single();
    expect(row).toEqual({ status: "sent", result: "present", message: "Welcome, Ada. Marked present at 07:42." });
  });

  it("keeps a tap waiting when the portal is down, and doesn't queue for a paused link", async () => {
    const tapEventId = Math.floor(Math.random() * 1e12) + 2e12;
    await queuePortalTap(db, { schoolId: ids.A!, studentId: ids.student!, tapEventId, cardUid: "04A1B2C3", admissionNo: "P-1", tappedAt: new Date() });
    const down = vi.fn(async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
    const r = await processPortalDeliveries(db, { schoolId: ids.A, fetchImpl: down });
    expect(r.retrying).toBe(1);
    const { data } = await db.from("portal_deliveries").select("status, attempts, next_at").eq("tap_event_id", tapEventId).single();
    expect(data?.status).toBe("pending");
    expect(data?.attempts).toBe(1);
    expect(new Date(data!.next_at as string).getTime()).toBeGreaterThan(Date.now());

    await db.from("portal_links").update({ enabled: false }).eq("school_id", ids.A!);
    expect(await queuePortalTap(db, { schoolId: ids.A!, studentId: ids.student!, tapEventId: tapEventId + 1, cardUid: "04A1B2C3", admissionNo: "P-1", tappedAt: new Date() })).toBe(false);
  });
});
