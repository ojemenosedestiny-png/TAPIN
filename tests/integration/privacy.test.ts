/**
 * Retention, two-factor enforcement and backups against a real Supabase project.
 * Throwaway school and logins, cleaned up.   RUN_RLS_TESTS=1 npm run test:rls
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHmac, randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { NextRequest } from "next/server";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = process.env.RUN_RLS_TESTS === "1" && !!url && !!anon && !!service;

/** RFC 6238 TOTP, as an authenticator app computes it. */
function totp(secretBase32: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secretBase32.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, "0");
}

let db: SupabaseClient;
const ids: Record<string, string> = {};
const logins: string[] = [];
const tag = `priv-${Date.now()}`;
const pw = `Pv-${randomUUID()}A1`;

describe.skipIf(!enabled)("privacy, two-factor and backups", () => {
  beforeAll(async () => {
    db = createClient(url!, service!, { auth: { persistSession: false } });
    const ins = async (t: string, row: Record<string, unknown>) => {
      const { data, error } = await db.from(t).insert(row).select("id").single();
      if (error) throw new Error(`${t}: ${error.message}`);
      return data.id as string;
    };
    ids.school = await ins("schools", { name: `Privacy Test ${tag}`, retention_months: 1 });
    const student = (n: string) => ins("students", { school_id: ids.school, admission_no: n, first_name: n, last_name: "T" });
    ids.oldLeaver = await student("OLD");
    ids.newLeaver = await student("NEW");
    ids.active = await student("ACT");
    ids.gOnly = await ins("guardians", { school_id: ids.school, name: "Only parent", phone: `+23480${Date.now().toString().slice(-8)}` });
    ids.gShared = await ins("guardians", { school_id: ids.school, name: "Shared parent", phone: `+23481${Date.now().toString().slice(-8)}` });
    await db.from("student_guardians").insert([
      { school_id: ids.school, student_id: ids.oldLeaver, guardian_id: ids.gOnly },
      { school_id: ids.school, student_id: ids.oldLeaver, guardian_id: ids.gShared },
      { school_id: ids.school, student_id: ids.active, guardian_id: ids.gShared },
    ]);
    await db.from("attendance").insert({ school_id: ids.school, holder_type: "student", holder_id: ids.oldLeaver, date: "2026-06-01", sign_in_at: "2026-06-01T06:40:00Z" });
    await db.from("cards").insert({ school_id: ids.school, uid: `0F${Date.now().toString(16).toUpperCase().slice(-8)}`, holder_type: "student", holder_id: ids.oldLeaver });
    await db.from("sms_logs").insert({ school_id: ids.school, student_id: ids.oldLeaver, guardian_id: ids.gOnly, phone: "+2348000000009", message: "x", type: "arrival", dedupe_key: `${tag}-sms` });
    await db.from("excusals").insert({ school_id: ids.school, student_id: ids.oldLeaver, date: "2026-06-02", reason: "Sick" });
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    await db.from("schools").delete().eq("id", ids.school);
    for (const id of logins) await db.auth.admin.deleteUser(id);
  });

  describe("retention", () => {
    it("stamps the leaving date when a student stops being active, and clears it if they return", async () => {
      await db.from("students").update({ status: "withdrawn" }).eq("id", ids.newLeaver);
      const { data: a } = await db.from("students").select("left_at").eq("id", ids.newLeaver).single();
      expect(a?.left_at).not.toBeNull();
      await db.from("students").update({ status: "active" }).eq("id", ids.newLeaver);
      const { data: b } = await db.from("students").select("left_at").eq("id", ids.newLeaver).single();
      expect(b?.left_at).toBeNull();
    });

    it("lists only leavers past the school's retention period", async () => {
      await db.from("students").update({ status: "withdrawn" }).in("id", [ids.oldLeaver, ids.newLeaver]);
      await db.from("students").update({ left_at: new Date(Date.now() - 90 * 86_400_000).toISOString() }).eq("id", ids.oldLeaver);
      const { data } = await db.rpc("students_due_for_deletion", { p_limit: 1000 });
      const mine = (data ?? []).filter((r: { school_id: string }) => r.school_id === ids.school).map((r: { student_id: string }) => r.student_id);
      expect(mine).toEqual([ids.oldLeaver]);
    });

    it("deletes everything about them, but keeps a parent shared with a current student", async () => {
      const { data: n } = await db.rpc("delete_student_records", { p_ids: [ids.oldLeaver] });
      expect(n).toBe(1);
      const gone = async (t: string, col: string, v: string) => (await db.from(t).select("*", { count: "exact", head: true }).eq(col, v)).count;
      expect(await gone("students", "id", ids.oldLeaver)).toBe(0);
      expect(await gone("attendance", "holder_id", ids.oldLeaver)).toBe(0);
      expect(await gone("cards", "holder_id", ids.oldLeaver)).toBe(0);
      expect(await gone("sms_logs", "student_id", ids.oldLeaver)).toBe(0);
      expect(await gone("excusals", "student_id", ids.oldLeaver)).toBe(0);
      expect(await gone("guardians", "id", ids.gOnly)).toBe(0);
      expect(await gone("guardians", "id", ids.gShared)).toBe(1);
      expect(await gone("students", "id", ids.active)).toBe(1);
      const { data: audit } = await db.from("audit_logs").select("action, details").eq("school_id", ids.school).eq("action", "retention.delete");
      expect(audit?.[0]?.details).toEqual({ students: 1 }); // no names in the log
    });
  });

  describe("two-factor login", () => {
    it("a password-only session sees nothing until the authenticator code is entered", async () => {
      const email = `${tag}-admin@example.com`;
      const { data: created } = await db.auth.admin.createUser({ email, password: pw, email_confirm: true });
      logins.push(created.user!.id);
      await db.from("users").insert({ id: created.user!.id, email, name: "Admin", role: "school_admin", school_id: ids.school });

      // Turn on two-factor, as the Account page does.
      const a = createClient(url!, anon!, { auth: { persistSession: false } });
      await a.auth.signInWithPassword({ email, password: pw });
      const { data: enrolled, error: enrollErr } = await a.auth.mfa.enroll({ factorType: "totp", friendlyName: "test" });
      expect(enrollErr).toBeNull();
      const { error: verifyErr } = await a.auth.mfa.challengeAndVerify({ factorId: enrolled!.id, code: totp(enrolled!.totp.secret) });
      expect(verifyErr).toBeNull();

      // A new sign-in with the password only.
      const b = createClient(url!, anon!, { auth: { persistSession: false } });
      await b.auth.signInWithPassword({ email, password: pw });
      const { data: level } = await b.auth.mfa.getAuthenticatorAssuranceLevel();
      expect(level).toMatchObject({ currentLevel: "aal1", nextLevel: "aal2" });
      expect((await b.from("students").select("id")).data).toEqual([]);
      expect((await b.from("schools").select("id")).data).toEqual([]);
      expect((await b.from("guardians").select("id")).data).toEqual([]);
      expect((await b.from("users").select("id")).data?.map((u) => u.id)).toEqual([created.user!.id]); // own profile only

      // Enter the code (next 30-second window, so it isn't a replay of the one above).
      await new Promise((r) => setTimeout(r, 31_000));
      const { error: codeErr } = await b.auth.mfa.challengeAndVerify({ factorId: enrolled!.id, code: totp(enrolled!.totp.secret) });
      expect(codeErr).toBeNull();
      const { data: students } = await b.from("students").select("id");
      expect(students?.length).toBeGreaterThan(0);
    }, 90_000);
  });

  describe("nightly backup", () => {
    it("writes every table and a manifest whose counts match the files", async () => {
      const { GET } = await import("@/app/api/cron/backup/route");
      const res = await GET(new NextRequest("http://localhost/api/cron/backup", { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.tables.schools).toBeGreaterThan(0);
      const { data: m } = await db.storage.from("backups").download(`${body.day}/manifest.json`);
      const manifest = JSON.parse(await m!.text());
      for (const [table, count] of Object.entries(manifest.tables as Record<string, number>)) {
        const { data: file } = await db.storage.from("backups").download(`${body.day}/${table}.ndjson.gz`);
        const lines = gunzipSync(Buffer.from(await file!.arrayBuffer())).toString("utf8").split("\n").filter(Boolean);
        expect(lines.length, table).toBe(count);
      }
      // Logged-in users can't read backups.
      const anonClient = createClient(url!, anon!, { auth: { persistSession: false } });
      const { data: leaked } = await anonClient.storage.from("backups").list("");
      expect(leaked ?? []).toEqual([]);
    }, 60_000);
  });
});
