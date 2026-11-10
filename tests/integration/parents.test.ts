/**
 * Parent portal access and WhatsApp sending against a real Supabase project
 * (throwaway school, cleaned up; fake senders, nothing is really sent).   RUN_RLS_TESTS=1 npm run test:rls
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { SendResult } from "@/lib/termii";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = process.env.RUN_RLS_TESTS === "1" && !!url && !!anon && !!service;

let db: SupabaseClient;
const ids: Record<string, string> = {};
const logins: string[] = [];
const tag = `par-${Date.now()}`;
const pw = `Pa-${randomUUID()}A1`;
const parentPhone = `+23490${Date.now().toString().slice(-8)}`;
const savedEnv = { key: process.env.TERMII_API_KEY, sender: process.env.TERMII_SENDER_ID };

describe.skipIf(!enabled)("parent portal and WhatsApp", () => {
  let asParent: SupabaseClient;
  let asStaff: SupabaseClient;

  beforeAll(async () => {
    db = createClient(url!, service!, { auth: { persistSession: false } });
    const ins = async (t: string, row: Record<string, unknown>) => {
      const { data, error } = await db.from(t).insert(row).select("id").single();
      if (error) throw new Error(`${t}: ${error.message}`);
      return data.id as string;
    };
    ids.school = await ins("schools", { name: `Parent Test ${tag}` });
    // No quiet hours, so these tests pass at any time of day (the default 20:00–06:00 would hold every message).
    await db.from("alert_settings").update({ quiet_start: "00:00", quiet_end: "00:00" }).eq("school_id", ids.school);
    ids.class = await ins("classes", { school_id: ids.school, name: "JSS1A" });
    ids.mine = await ins("students", { school_id: ids.school, class_id: ids.class, admission_no: "P1", first_name: "Ada", last_name: "Mine", created_at: "2026-10-01T00:00:00Z" });
    ids.other = await ins("students", { school_id: ids.school, class_id: ids.class, admission_no: "P2", first_name: "Bayo", last_name: "Other" });
    ids.guardian = await ins("guardians", { school_id: ids.school, name: "Parent", phone: parentPhone });
    ids.otherGuardian = await ins("guardians", { school_id: ids.school, name: "Someone else", phone: `+23491${Date.now().toString().slice(-8)}` });
    await db.from("student_guardians").insert([
      { school_id: ids.school, student_id: ids.mine, guardian_id: ids.guardian },
      { school_id: ids.school, student_id: ids.other, guardian_id: ids.otherGuardian },
    ]);
    await db.from("attendance").insert({ school_id: ids.school, holder_type: "student", holder_id: ids.mine, date: "2026-11-03", sign_in_at: "2026-11-03T06:40:00Z" });

    // A parent login: phone number, no staff profile. (Email too, so the test can sign in with a password.)
    const { data: p } = await db.auth.admin.createUser({ email: `${tag}-parent@example.com`, phone: parentPhone.slice(1), password: pw, email_confirm: true, phone_confirm: true });
    logins.push(p.user!.id);
    asParent = createClient(url!, anon!, { auth: { persistSession: false } });
    await asParent.auth.signInWithPassword({ email: `${tag}-parent@example.com`, password: pw });

    // A staff login with the same phone must NOT be treated as a parent.
    const { data: s } = await db.auth.admin.createUser({ email: `${tag}-staff@example.com`, password: pw, email_confirm: true });
    logins.push(s.user!.id);
    await db.from("users").insert({ id: s.user!.id, email: `${tag}-staff@example.com`, name: "Staff", role: "teacher", school_id: ids.school });
    asStaff = createClient(url!, anon!, { auth: { persistSession: false } });
    await asStaff.auth.signInWithPassword({ email: `${tag}-staff@example.com`, password: pw });
  }, 60_000);

  afterAll(async () => {
    process.env.TERMII_API_KEY = savedEnv.key;
    process.env.TERMII_SENDER_ID = savedEnv.sender;
    if (!db) return;
    await db.from("schools").delete().eq("id", ids.school);
    for (const id of logins) await db.auth.admin.deleteUser(id);
  });

  it("a parent sees only their own child", async () => {
    const { data, error } = await asParent.rpc("parent_children");
    expect(error).toBeNull();
    expect((data ?? []).map((c: { student_id: string }) => c.student_id)).toEqual([ids.mine]);
  });

  it("a parent can read their child's days but not another child's", async () => {
    const { data: mine } = await asParent.rpc("parent_attendance", { p_student: ids.mine, p_from: "2026-11-02", p_to: "2026-11-06" });
    expect((mine ?? []).find((d: { date: string }) => d.date === "2026-11-03")).toMatchObject({ status: "present" });
    const { data: other } = await asParent.rpc("parent_attendance", { p_student: ids.other, p_from: "2026-11-02", p_to: "2026-11-06" });
    expect(other).toEqual([]);
  });

  it("parents get nothing from the school's tables directly", async () => {
    for (const t of ["students", "guardians", "attendance", "classes", "sms_logs"]) {
      expect((await asParent.from(t).select("*").limit(5)).data ?? [], t).toEqual([]);
    }
  });

  it("staff are never treated as parents", async () => {
    const { data } = await asStaff.rpc("parent_children");
    expect(data ?? []).toEqual([]);
  });

  it("a parent can switch their own alerts to WhatsApp, and nobody else's", async () => {
    const { data: n, error } = await asParent.rpc("parent_set_channel", { p_channel: "whatsapp" });
    expect(error).toBeNull();
    expect(n).toBe(1);
    const { data: g } = await db.from("guardians").select("id, channel").in("id", [ids.guardian, ids.otherGuardian]);
    expect(Object.fromEntries((g ?? []).map((x) => [x.id, x.channel]))).toEqual({ [ids.guardian]: "whatsapp", [ids.otherGuardian]: "sms" });
  });

  it("the sender uses WhatsApp for that parent, and falls back to SMS if WhatsApp refuses", async () => {
    process.env.TERMII_API_KEY = "test-key-not-real";
    process.env.TERMII_SENDER_ID = "TapInTest";
    const { processOutbox } = await import("@/lib/alerts");
    const sms: string[] = [];
    const wa: Record<string, string>[] = [];
    const smsOk = async (_c: unknown, _to: string, message: string): Promise<SendResult> => { sms.push(message); return { ok: true, messageId: "s" }; };
    const waOk = async (_c: unknown, _to: string, _t: unknown, data: Record<string, string>): Promise<SendResult> => { wa.push(data); return { ok: true, messageId: "w" }; };
    const waRefused = async (): Promise<SendResult> => ({ ok: false, error: "WhatsApp 400: template not approved", retryable: false });
    const templateFor = () => ({ deviceId: "dev", templateId: "tpl" });

    const queue = async (key: string) => db.from("sms_logs").insert({
      school_id: ids.school, student_id: ids.mine, guardian_id: ids.guardian, phone: parentPhone, type: "arrival",
      message: "Ada Mine arrived at school at 7:40 AM.", dedupe_key: `${tag}-${key}`,
      vars: { "1": "Ada Mine", "2": "Parent Test", "3": "7:40 AM" },
    });

    await queue("wa");
    await processOutbox(db, { send: smsOk, sendWa: waOk, templateFor, schoolId: ids.school });
    expect(wa).toEqual([{ "1": "Ada Mine", "2": "Parent Test", "3": "7:40 AM" }]);
    expect(sms).toEqual([]);
    const { data: a } = await db.from("sms_logs").select("status, channel").eq("dedupe_key", `${tag}-wa`).single();
    expect(a).toEqual({ status: "sent", channel: "whatsapp" });

    await queue("fallback");
    await processOutbox(db, { send: smsOk, sendWa: waRefused, templateFor, schoolId: ids.school });
    expect(sms).toEqual(["Ada Mine arrived at school at 7:40 AM."]);
    const { data: b } = await db.from("sms_logs").select("status, channel").eq("dedupe_key", `${tag}-fallback`).single();
    expect(b).toEqual({ status: "sent", channel: "sms" });
  });

  it("with no SMS sender ID yet, every parent gets WhatsApp, even those who chose SMS", async () => {
    const saved = process.env.TERMII_WHATSAPP_DEVICE_ID;
    process.env.TERMII_API_KEY = "test-key-not-real";
    process.env.TERMII_SENDER_ID = "";
    process.env.TERMII_WHATSAPP_DEVICE_ID = "dev";
    try {
      const { processOutbox } = await import("@/lib/alerts");
      const sms: string[] = [];
      const wa: Record<string, string>[] = [];
      const smsNever = async (_c: unknown, _to: string, message: string): Promise<SendResult> => { sms.push(message); return { ok: true, messageId: "s" }; };
      const waOk = async (_c: unknown, _to: string, _t: unknown, data: Record<string, string>): Promise<SendResult> => { wa.push(data); return { ok: true, messageId: "w" }; };
      await db.from("sms_logs").insert({
        school_id: ids.school, student_id: ids.mine, guardian_id: ids.otherGuardian, phone: "+2348039999999", type: "arrival",
        message: "Ada Mine arrived at school at 7:41 AM.", dedupe_key: `${tag}-wa-only`,
        vars: { "1": "Ada Mine", "2": "Parent Test", "3": "7:41 AM" },
      });
      const r = await processOutbox(db, { send: smsNever, sendWa: waOk, templateFor: () => ({ deviceId: "dev", templateId: "tpl" }), schoolId: ids.school });
      expect(r.notConfigured).toBe(false);
      expect(sms).toEqual([]);
      expect(wa).toEqual([{ "1": "Ada Mine", "2": "Parent Test", "3": "7:41 AM" }]);
      const { data } = await db.from("sms_logs").select("status, channel").eq("dedupe_key", `${tag}-wa-only`).single();
      expect(data).toEqual({ status: "sent", channel: "whatsapp" });
    } finally {
      if (saved === undefined) delete process.env.TERMII_WHATSAPP_DEVICE_ID;
      else process.env.TERMII_WHATSAPP_DEVICE_ID = saved;
    }
  });
});
