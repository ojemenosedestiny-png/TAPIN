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

describe.skipIf(!enabled)("WhatsApp assistant: requests that change something", () => {
  const ids2: Record<string, string> = {};
  const MUM = `+234809${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  const today2 = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
  let answer2: typeof import("@/lib/whatsapp-assistant-server").answer;
  let handleInbound: typeof import("@/lib/whatsapp-assistant-server").handleInbound;
  let hash: typeof import("@/lib/pickup").hashPickupCode;

  beforeAll(async () => {
    ({ answer: answer2, handleInbound } = await import("@/lib/whatsapp-assistant-server"));
    ({ hashPickupCode: hash } = await import("@/lib/pickup"));
    db ??= createClient(url!, service!, { auth: { persistSession: false } });
    const ins = async (t: string, row: Record<string, unknown>) => {
      const { data, error } = await db.from(t).insert(row).select("id").single();
      if (error) throw new Error(`${t}: ${error.message}`);
      return data?.id as string;
    };
    ids2.school = await ins("schools", { name: `wa-requests-${Date.now()}`, resumption_time: "07:45", closing_time: "14:00", absence_cutoff_time: "09:00" });
    ids2.ada = await ins("students", { school_id: ids2.school, admission_no: "R-1", first_name: "Ada", last_name: "Eze" });
    ids2.kola = await ins("students", { school_id: ids2.school, admission_no: "R-2", first_name: "Kola", last_name: "Eze" });
    ids2.mum = await ins("guardians", { school_id: ids2.school, name: "Ngozi Eze", phone: MUM });
    await db.from("student_guardians").insert([
      { school_id: ids2.school, student_id: ids2.ada, guardian_id: ids2.mum },
      { school_id: ids2.school, student_id: ids2.kola, guardian_id: ids2.mum },
    ]);
    // Ada is already in school today; Kola isn't.
    await db.from("attendance").insert({ school_id: ids2.school, holder_type: "student", holder_id: ids2.ada, date: today2, sign_in_at: new Date(Date.now() - 3600_000).toISOString() });
  }, 60_000);

  afterAll(async () => {
    if (db && ids2.school) await db.from("schools").delete().eq("id", ids2.school);
    await db?.from("whatsapp_pending").delete().eq("phone", MUM);
    await db?.from("whatsapp_messages").delete().eq("phone", MUM);
  });

  it("asks which child, then makes a code that works for that child only, today, once", async () => {
    const q = await answer2(db, MUM, "I need a pickup code");
    expect(q.reply).toBe("Which child is the pickup code for? Reply with a number:\n1 Ada\n2 Kola\n3 All of them");
    const r = await answer2(db, MUM, "1");
    expect(r.command).toBe("code");
    const code = r.reply!.match(/\*(\d{3}) (\d{3})\*/)!.slice(1).join("");
    const { data: row } = await db.from("pickup_codes").select("id, valid_date, source, used_at, created_by_guardian_id, pickup_code_students(student_id)").eq("school_id", ids2.school).eq("code_hash", hash(ids2.school, code)).single();
    expect(row).toMatchObject({ valid_date: today2, source: "whatsapp", used_at: null, created_by_guardian_id: ids2.mum });
    expect((row!.pickup_code_students as { student_id: string }[]).map((s) => s.student_id)).toEqual([ids2.ada]);
    // The question is answered: "1" now means today's attendance again.
    expect((await answer2(db, MUM, "1")).command).toBe("attendance");
  });

  it("naming the child skips the question; codes are limited to three a day", async () => {
    expect((await answer2(db, MUM, "send a code for Kola")).reply).toMatch(/Pickup code for Kola today/);
    expect((await answer2(db, MUM, "pickup code for both")).reply).toMatch(/Pickup code for Ada and Kola today/);
    expect((await answer2(db, MUM, "another code for Ada")).reply).toMatch(/3 pickup codes today, the most allowed/);
  });

  it("records a sick day as excused (no absence alert), but not for a child already in school", async () => {
    const r = await answer2(db, MUM, "Kola no well, he no go come school today");
    expect(r.reply).toMatch(/^Kola is marked absent today \(sick\)\. The school won't send an absence alert\./);
    const { data: exc } = await db.from("excusals").select("reason, source, guardian_id").eq("student_id", ids2.kola).eq("date", today2).single();
    expect(exc).toMatchObject({ source: "whatsapp", guardian_id: ids2.mum });
    expect(exc!.reason).toMatch(/^Sick \(parent, by WhatsApp\): Kola no well/);
    expect((await answer2(db, MUM, "Ada is sick today")).reply).toMatch(/Ada already signed in today at .+, so I haven't marked them absent/);
    expect((await answer2(db, MUM, "Kola is sick today")).reply).toBe("Kola is already marked absent today.");
  });

  it("sends an early pickup request to the school, asking for the time when it's missing", async () => {
    const r = await answer2(db, MUM, "I'm collecting Ada at 12:30");
    expect(r.reply).toMatch(/Ada: I've told the school you'll collect them at 12:30 PM today\./);
    const { data: req } = await db.from("early_pickup_requests").select("at_time, status, source").eq("student_id", ids2.ada).eq("date", today2).single();
    expect(req).toEqual({ at_time: "12:30:00", status: "pending", source: "whatsapp" });
    const { data: notice } = await db.from("notifications").select("message").eq("school_id", ids2.school).eq("kind", "early_pickup");
    expect(notice?.[0]?.message).toBe("Ngozi Eze will collect Ada Eze early today at 12:30 PM (by WhatsApp).");

    expect((await answer2(db, MUM, "I go pick Ada early")).reply).toBe("What time will you collect Ada? For example: 12:30 or 1pm.");
    // A bare "1" is the menu (today's attendance), not 1 o'clock; the question stays open.
    expect((await answer2(db, MUM, "1")).command).toBe("attendance");
    expect((await answer2(db, MUM, "I go pick Ada early")).command).toBe("early");
    expect((await answer2(db, MUM, "1pm")).reply).toMatch(/collect them at 1:00 PM today/);
    const { data: moved } = await db.from("early_pickup_requests").select("at_time").eq("student_id", ids2.ada).eq("date", today2).single();
    expect(moved?.at_time).toBe("13:00:00");
  });

  it("answers absence history for the term, with the start date", async () => {
    const r = await answer2(db, MUM, "How many days did Kola miss this term?");
    expect(r.command).toBe("absences");
    expect(r.reply).toMatch(/^Kola: .* since /);
    expect(r.reply).not.toMatch(/Ada:/);
    // Kola was added to TapIn today: no days before that count as absent.
    expect(r.reply).toMatch(/^Kola: no unexplained absences since /);
  });

  it("acts once when WhatsApp delivers the same message twice", async () => {
    const before = (await db.from("pickup_codes").select("id").eq("school_id", ids2.school)).data!.length;
    // Start the day's code count again (the limit was reached above): the memory counter and the stored one.
    resetRateLimits();
    const { hashLimitKey } = await import("@/lib/rate-limit-shared");
    await db.from("rate_limits").delete().eq("key", hashLimitKey(`wa-code:${MUM}`));
    const msg = { phone: MUM.slice(1), text: "pickup code for Kola please", id: `wamid.test-${Date.now()}` };
    await handleInbound(db, msg);
    await handleInbound(db, msg);
    const after = (await db.from("pickup_codes").select("id").eq("school_id", ids2.school)).data!.length;
    expect(after - before).toBe(1);
  });
});

describe.skipIf(!enabled)("WhatsApp assistant: staff PINs", () => {
  const STAFF = `+234809${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  const sids: Record<string, string> = {};
  let answer3: typeof import("@/lib/whatsapp-assistant-server").answer;
  let checkPin: typeof import("@/lib/emergency").checkPin;

  beforeAll(async () => {
    ({ answer: answer3 } = await import("@/lib/whatsapp-assistant-server"));
    ({ checkPin } = await import("@/lib/emergency"));
    db ??= createClient(url!, service!, { auth: { persistSession: false } });
    const { data: s } = await db.from("schools").insert({ name: `wa-staff-${Date.now()}`, staff_pin_required: true }).select("id").single();
    sids.school = s!.id;
    const { data: st } = await db.from("staff").insert({ school_id: sids.school, name: "Tunde Bello", phone: STAFF }).select("id").single();
    sids.staff = st!.id;
    await db.from("staff_pins").insert({ staff_id: sids.staff, school_id: sids.school, pin_hash: "scrypt$00$00", failures: 5, locked_until: new Date(Date.now() + 600_000).toISOString() });
  }, 60_000);

  afterAll(async () => {
    if (db && sids.school) {
      await db.from("audit_logs").delete().eq("school_id", sids.school);
      await db.from("schools").delete().eq("id", sids.school);
    }
    await db?.from("whatsapp_pending").delete().eq("phone", STAFF);
  });

  it("a staff member who isn't a parent gets the staff menu", async () => {
    const r = await answer3(db, STAFF, "Hi");
    expect(r.command).toBe("staff_menu");
    expect(r.reply).toContain("Hello Tunde");
  });

  it("\"Generate ping\" makes a new PIN that works at the kiosk, lifts the lockout and tells the admin", async () => {
    const r = await answer3(db, STAFF, "Generate ping");
    expect(r.command).toBe("staff_pin");
    const pin = r.reply!.match(/is \*(\d{4})\*/)![1]!;
    const { data: row } = await db.from("staff_pins").select("pin_hash, failures, locked_until").eq("staff_id", sids.staff).single();
    expect(checkPin(pin, row!.pin_hash)).toBe(true);
    expect(row).toMatchObject({ failures: 0, locked_until: null });
    const { data: n } = await db.from("notifications").select("message").eq("school_id", sids.school).eq("kind", "staff_pin");
    expect(n![0]!.message).toContain("Tunde Bello got a new check-in PIN by WhatsApp");
  });

  it("says no PIN is needed when the school has PINs off", async () => {
    await db.from("schools").update({ staff_pin_required: false }).eq("id", sids.school);
    expect((await answer3(db, STAFF, "PIN")).reply).toContain("doesn't ask for a PIN");
  });
});
