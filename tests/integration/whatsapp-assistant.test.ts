/**
 * WhatsApp assistant answers against a real Supabase project (throwaway school, cleaned up).
 * Only answer() is called, so nothing is ever sent.
 *   RUN_RLS_TESTS=1 npx vitest run tests/integration/whatsapp-assistant.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resetRateLimits } from "@/lib/rate-limit";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = process.env.RUN_RLS_TESTS === "1" && !!url && !!service;

let db: SupabaseClient;
let answer: typeof import("@/lib/whatsapp-assistant-server").answer;
const ids: Record<string, string> = {};
// A number no real parent has: +234 80 9 then 8 random digits.
const PHONE = `+234809${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

describe.skipIf(!enabled)("WhatsApp assistant", () => {
  beforeAll(async () => {
    ({ answer } = await import("@/lib/whatsapp-assistant-server"));
    resetRateLimits();
    db = createClient(url!, service!, { auth: { persistSession: false } });
    const ins = async (t: string, row: Record<string, unknown>) => {
      const { data, error } = await db.from(t).insert(row).select("id").single();
      if (error) throw new Error(`${t}: ${error.message}`);
      return data?.id as string;
    };
    ids.school = await ins("schools", { name: `wa-test-${Date.now()}`, resumption_time: "07:45", closing_time: "14:00", absence_cutoff_time: "09:00" });
    ids.ada = await ins("students", { school_id: ids.school, admission_no: "W-1", first_name: "Ada", last_name: "Obi" });
    ids.guardian = await ins("guardians", { school_id: ids.school, name: "Ngozi Obi", phone: PHONE });
    const { error: linkErr } = await db.from("student_guardians").insert({ school_id: ids.school, student_id: ids.ada, guardian_id: ids.guardian });
    if (linkErr) throw new Error(linkErr.message);
    await db.from("attendance").insert({ school_id: ids.school, holder_type: "student", holder_id: ids.ada, date: today, sign_in_at: new Date(Date.now() - 3600_000).toISOString() });
  }, 60_000);

  afterAll(async () => {
    if (db && ids.school) await db.from("schools").delete().eq("id", ids.school);
  });

  it("greets a registered parent with the menu", async () => {
    const r = await answer(db, PHONE.slice(1), "Hi");
    expect(r.command).toBe("menu");
    expect(r.reply).toContain("Hello Ngozi");
    expect(r.schoolId).toBe(ids.school);
  });

  it("answers today's attendance for their own child", async () => {
    const r = await answer(db, PHONE, "1");
    expect(r.reply).toMatch(/^Ada: in at .+, still in school\.$/);
  });

  it("answers pickup and who can collect", async () => {
    expect((await answer(db, PHONE, "3")).reply).toBe("Ada has not been collected yet today.");
    expect((await answer(db, PHONE, "5")).reply).toContain("Ada: only parents on record");
  });

  it("says when it doesn't understand", async () => {
    expect((await answer(db, PHONE, "what's for lunch")).reply).toContain("Reply 0 for the menu");
  });

  it("an unknown number learns it isn't registered, once a day", async () => {
    const stranger = `+234809${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
    const first = await answer(db, stranger, "1");
    expect(first.command).toBe("unregistered");
    expect(first.reply).toContain("isn't registered");
    expect((await answer(db, stranger, "1")).reply).toBeNull();
  });

  it("the webhook refuses calls without the secret", async () => {
    const { POST } = await import("@/app/api/whatsapp/inbound/route");
    const res = await POST(new NextRequest("http://localhost/api/whatsapp/inbound?key=wrong", { method: "POST", body: JSON.stringify({ sender: PHONE, message: "1" }) }));
    expect(res.status).toBe(401);
  });
});
