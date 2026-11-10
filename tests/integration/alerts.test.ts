/**
 * Alert pipeline against a real Supabase project, with a FAKE sender (no real SMS is sent).
 * Throwaway school, cleaned up afterwards.   RUN_RLS_TESTS=1 npm run test:rls
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SendResult } from "@/lib/termii";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = process.env.RUN_RLS_TESTS === "1" && !!url && !!service;

let db: SupabaseClient;
let alerts: typeof import("@/lib/alerts");
const ids: Record<string, string> = {};
const savedEnv = { key: process.env.TERMII_API_KEY, sender: process.env.TERMII_SENDER_ID };

// A past Wednesday, so it's a school day and every time is in the past.
const DAY = "2026-11-04";
const lagos = (hhmm: string, date = DAY) => new Date(`${date}T${hhmm}:00+01:00`);

const sent: { to: string; message: string }[] = [];
const ok = async (_c: unknown, to: string, message: string): Promise<SendResult> => { sent.push({ to, message }); return { ok: true, messageId: `fake-${sent.length}` }; };
const down = async (): Promise<SendResult> => ({ ok: false, error: "Termii 503: down", retryable: true });
const rejected = async (): Promise<SendResult> => ({ ok: false, error: "Termii 400: Sender ID not approved", retryable: false });

async function rows(type?: string) {
  let q = db.from("sms_logs").select("id, type, status, phone, message, attempts, last_error, next_attempt_at, dedupe_key").eq("school_id", ids.school);
  if (type) q = q.eq("type", type);
  return (await q).data ?? [];
}

describe.skipIf(!enabled)("alerts pipeline", () => {
  beforeAll(async () => {
    process.env.TERMII_API_KEY = "test-key-not-real";
    process.env.TERMII_SENDER_ID = "TapInTest";
    alerts = await import("@/lib/alerts");
    db = createClient(url!, service!, { auth: { persistSession: false } });
    const ins = async (t: string, row: Record<string, unknown>) => {
      const { data, error } = await db.from(t).insert(row).select("id").single();
      if (error) throw new Error(`${t}: ${error.message}`);
      return data.id as string;
    };
    ids.school = await ins("schools", { name: `Alert Test ${Date.now()}`, resumption_time: "07:45", absence_cutoff_time: "09:00", closing_time: "14:00" });
    ids.class = await ins("classes", { school_id: ids.school, name: "JSS2A" });
    const student = (first: string, n: number) => ins("students", {
      school_id: ids.school, class_id: ids.class, admission_no: `A${n}`, first_name: first, last_name: "Test", created_at: "2026-01-01T00:00:00Z",
    });
    ids.present = await student("Chioma", 1);
    ids.absent = await student("David", 2);
    ids.excused = await student("Amaka", 3);
    ids.noGuardian = await student("Tunde", 4);
    const guardian = (phone: string) => ins("guardians", { school_id: ids.school, name: "Parent", phone });
    ids.g1 = await guardian(`+23480${Date.now().toString().slice(-8)}`);
    ids.g2 = await guardian(`+23481${Date.now().toString().slice(-8)}`);
    ids.g3 = await guardian(`+23470${Date.now().toString().slice(-8)}`);
    await db.from("student_guardians").insert([
      { school_id: ids.school, student_id: ids.present, guardian_id: ids.g1 },
      { school_id: ids.school, student_id: ids.present, guardian_id: ids.g2 },
      { school_id: ids.school, student_id: ids.absent, guardian_id: ids.g3 },
      { school_id: ids.school, student_id: ids.excused, guardian_id: ids.g3 },
    ]);
  }, 60_000);

  afterAll(async () => {
    process.env.TERMII_API_KEY = savedEnv.key;
    process.env.TERMII_SENDER_ID = savedEnv.sender;
    if (db && ids.school) await db.from("schools").delete().eq("id", ids.school);
  });

  const student = () => ({ id: ids.present, firstName: "Chioma", fullName: "Chioma Test", classId: ids.class, className: "JSS2A" });
  const school = () => ({ id: ids.school, name: "Alert Test School", timezone: "Africa/Lagos" });

  it("every new school gets default alert settings", async () => {
    const { data } = await db.from("alert_settings").select("arrival_enabled, absence_template").eq("school_id", ids.school).single();
    expect(data?.arrival_enabled).toBe(true);
    expect(data?.absence_template).toMatch(/has not signed in/);
  });

  it("arrival queues one SMS per guardian, saved to sms_logs first", async () => {
    const n = await alerts.queueTapAlerts(db, { school: school(), student: student(), action: "signed_in", late: false, tappedAt: lagos("07:42") });
    expect(n).toBe(2);
    const r = await rows("arrival");
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.status === "queued")).toBe(true);
    expect(r[0]!.message).toBe("Good morning. Chioma Test arrived at Alert Test School at 7:42 AM.");
  });

  it("a second arrival SMS for the same child on the same day is never created", async () => {
    const n = await alerts.queueTapAlerts(db, { school: school(), student: student(), action: "signed_in", late: false, tappedAt: lagos("07:50") });
    expect(n).toBe(0);
    expect(await rows("arrival")).toHaveLength(2);
  });

  it("late arrival notifies guardians and the class teacher's dashboard", async () => {
    const other = { ...student(), id: ids.absent, firstName: "David", fullName: "David Test" };
    await alerts.queueTapAlerts(db, { school: school(), student: other, action: "signed_in", late: true, tappedAt: lagos("08:20") });
    const late = await rows("late");
    expect(late.map((x) => x.message)).toEqual(["David Test arrived late at Alert Test School at 8:20 AM."]);
    const { data: n } = await db.from("notifications").select("kind, class_id, message").eq("school_id", ids.school).eq("kind", "late_arrival");
    expect(n?.[0]).toMatchObject({ class_id: ids.class, message: "David Test (JSS2A) arrived late at 8:20 AM." });
    await db.from("sms_logs").delete().eq("school_id", ids.school).eq("type", "late");
  });

  it("sends queued messages and marks them sent", async () => {
    const r = await alerts.processOutbox(db, { send: ok, schoolId: ids.school, now: () => lagos("07:45", new Date().toISOString().slice(0, 10)) });
    expect(r.sent).toBe(2);
    expect((await rows("arrival")).every((x) => x.status === "sent")).toBe(true);
  });

  it("failed messages retry 3 times, 2 minutes apart, then show as failed", async () => {
    await db.from("sms_logs").insert({ school_id: ids.school, phone: "+2348030000001", message: "retry me", type: "departure", dedupe_key: `retry-${ids.school}` });
    const noon = () => new Date(new Date().toISOString().slice(0, 10) + "T12:00:00+01:00");
    for (let attempt = 1; attempt <= 4; attempt++) {
      await alerts.processOutbox(db, { send: down, schoolId: ids.school, now: noon });
      const [m] = (await rows("departure")).filter((x) => x.message === "retry me");
      expect(m!.attempts).toBe(attempt);
      if (attempt < 4) {
        expect(m!.status).toBe("queued");
        expect(new Date(m!.next_attempt_at).getTime() - noon().getTime()).toBe(2 * 60 * 1000);
        await db.from("sms_logs").update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq("id", m!.id);
      } else {
        expect(m!.status).toBe("failed");
      }
    }
    const { data: n } = await db.from("notifications").select("kind").eq("school_id", ids.school).eq("kind", "sms_failed");
    expect(n).toHaveLength(1);
  });

  it("a definite rejection (e.g. unapproved sender) fails without retrying", async () => {
    await db.from("sms_logs").insert({ school_id: ids.school, phone: "+2348030000002", message: "reject me", type: "departure", dedupe_key: `reject-${ids.school}` });
    await alerts.processOutbox(db, { send: rejected, schoolId: ids.school });
    const [m] = (await rows("departure")).filter((x) => x.message === "reject me");
    expect(m).toMatchObject({ status: "failed", attempts: 1, last_error: "Termii 400: Sender ID not approved" });
  });

  it("quiet hours hold messages until they end", async () => {
    // Quiet window from an hour ago until an hour from now (Lagos time).
    const hm = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Lagos" });
    const now = new Date();
    const end = new Date(now.getTime() + 3600_000);
    await db.from("alert_settings").update({ quiet_start: hm(new Date(now.getTime() - 3600_000)), quiet_end: hm(end) }).eq("school_id", ids.school);
    await db.from("sms_logs").insert({ school_id: ids.school, phone: "+2348030000003", message: "quiet", type: "departure", dedupe_key: `quiet-${ids.school}` });
    const r = await alerts.processOutbox(db, { send: ok, schoolId: ids.school });
    expect(r.held).toBe(1);
    const [m] = (await rows("departure")).filter((x) => x.message === "quiet");
    expect(m!.status).toBe("queued");
    const wait = new Date(m!.next_attempt_at).getTime() - now.getTime();
    expect(wait).toBeGreaterThan(55 * 60_000); // held until the window ends, about an hour away
    expect(wait).toBeLessThan(61 * 60_000);
    await db.from("sms_logs").delete().eq("id", m!.id);
    await db.from("alert_settings").update({ quiet_start: "20:00", quiet_end: "06:00" }).eq("school_id", ids.school);
  });

  it("stops sending when the monthly allowance is used up", async () => {
    await db.from("alert_settings").update({ monthly_allowance: 2 }).eq("school_id", ids.school); // 2 already sent
    await db.from("sms_logs").insert({ school_id: ids.school, phone: "+2348030000004", message: "over allowance", type: "departure", dedupe_key: `allow-${ids.school}` });
    const before = sent.length;
    const r = await alerts.processOutbox(db, { send: ok, schoolId: ids.school });
    expect(r.skipped).toBe(1);
    expect(sent.length).toBe(before);
    const { data: n } = await db.from("notifications").select("kind").eq("school_id", ids.school).eq("kind", "allowance");
    expect(n).toHaveLength(1);
    await db.from("alert_settings").update({ monthly_allowance: 5000 }).eq("school_id", ids.school);
  });

  it("drops messages too old to be useful", async () => {
    await db.from("sms_logs").insert({
      school_id: ids.school, phone: "+2348030000005", message: "stale", type: "arrival", dedupe_key: `stale-${ids.school}`,
      created_at: new Date(Date.now() - 7 * 3600_000).toISOString(),
    });
    await alerts.processOutbox(db, { send: ok, schoolId: ids.school });
    const [m] = (await rows("arrival")).filter((x) => x.message === "stale");
    expect(m).toMatchObject({ status: "skipped", last_error: "Expired: too old to be useful" });
  });

  describe("absence job", () => {
    beforeAll(async () => {
      await db.from("attendance").insert({ school_id: ids.school, holder_type: "student", holder_id: ids.present, date: DAY, sign_in_at: lagos("07:40").toISOString(), sign_out_at: lagos("14:10").toISOString() });
      await db.from("excusals").insert({ school_id: ids.school, student_id: ids.excused, date: DAY, reason: "Sick note" });
    });
    const absences = async () => (await rows("absence")).filter((x) => x.dedupe_key.includes(`:${DAY}:`));

    it("does nothing before the cutoff", async () => {
      await db.rpc("queue_absence_alerts", { p_now: lagos("08:59").toISOString(), p_school: ids.school });
      expect(await absences()).toHaveLength(0);
    });

    it("after the cutoff, alerts the guardians of absent students only (not present, excused or guardian-less)", async () => {
      await db.rpc("queue_absence_alerts", { p_now: lagos("09:10").toISOString(), p_school: ids.school });
      const a = await absences();
      expect(a).toHaveLength(1);
      expect(a[0]!.message).toMatch(/^Dear parent, David Test has not signed in at Alert Test/);
    });

    it("running every 15 minutes never repeats an alert", async () => {
      await db.rpc("queue_absence_alerts", { p_now: lagos("09:25").toISOString(), p_school: ids.school });
      await db.rpc("queue_absence_alerts", { p_now: lagos("09:40").toISOString(), p_school: ids.school });
      expect(await absences()).toHaveLength(1);
    });

    it("skips weekends and holidays", async () => {
      await db.rpc("queue_absence_alerts", { p_now: lagos("10:00", "2026-11-07").toISOString(), p_school: ids.school }); // Saturday
      await db.from("school_calendar").insert({ school_id: ids.school, date: "2026-11-05", note: "Holiday" });
      await db.rpc("queue_absence_alerts", { p_now: lagos("10:00", "2026-11-05").toISOString(), p_school: ids.school });
      expect(await absences()).toHaveLength(1);
    });

    it("daily summary mode sends one evening SMS per guardian", async () => {
      await db.from("alert_settings").update({ summary_mode: true, summary_time: "17:00" }).eq("school_id", ids.school);
      await db.rpc("queue_daily_summaries", { p_now: lagos("16:30").toISOString(), p_school: ids.school });
      expect(await rows("summary")).toHaveLength(0);
      await db.rpc("queue_daily_summaries", { p_now: lagos("17:15").toISOString(), p_school: ids.school });
      const s = await rows("summary");
      expect(s).toHaveLength(2);
      expect(s[0]!.message).toBe("Chioma Test today at " + (await db.from("schools").select("name").eq("id", ids.school).single()).data!.name + ": arrived 7:40 AM, left 2:10 PM.");
    });
  });

  it("an offline kiosk raises one notification per offline spell", async () => {
    const { data: dev } = await db.from("devices").insert({
      school_id: ids.school, name: "Test Gate", token_hash: `hash-${Date.now()}`, last_seen: lagos("09:30").toISOString(),
    }).select("id").single();
    await db.rpc("check_offline_devices", { p_now: lagos("09:35").toISOString(), p_school: ids.school }); // 5 min: fine
    await db.rpc("check_offline_devices", { p_now: lagos("09:45").toISOString(), p_school: ids.school }); // 15 min: offline
    await db.rpc("check_offline_devices", { p_now: lagos("10:00").toISOString(), p_school: ids.school }); // still offline: no repeat
    const { data: n } = await db.from("notifications").select("message").eq("school_id", ids.school).eq("kind", "device_offline");
    expect(n?.map((x) => x.message)).toEqual(["Test Gate kiosk is offline."]);
    expect(dev).toBeTruthy();
  });

  it("guardians' phone numbers and SMS are invisible to other schools' admins (RLS)", async () => {
    // The anon key alone (no login) sees nothing.
    const anon = createClient(url!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    for (const t of ["sms_logs", "notifications", "alert_settings", "excusals"]) {
      const { data } = await anon.from(t).select("*").limit(1);
      expect(data ?? [], t).toEqual([]);
    }
  });
});
