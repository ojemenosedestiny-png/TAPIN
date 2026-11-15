/**
 * Renewal reminders against a real Supabase project (throwaway school and plan, cleaned up).
 *   RUN_RLS_TESTS=1 npx vitest run tests/integration/renewals.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendRenewalReminders } from "@/lib/renewals";
import { addDays } from "@/lib/subscriptions";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = process.env.RUN_RLS_TESTS === "1" && !!url && !!service;

let db: SupabaseClient;
const ids: Record<string, string> = {};
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

describe.skipIf(!enabled)("renewal reminders", () => {
  beforeAll(async () => {
    db = createClient(url!, service!, { auth: { persistSession: false } });
    const { data: s } = await db.from("schools").insert({ name: `renewal-test-${Date.now()}` }).select("id").single();
    ids.school = s!.id;
    const { data: p } = await db.from("subscription_plans").insert({ name: `renewal-test-plan-${Date.now()}`, min_students: 0, monthly_price: 1000, active: false, sort: 999 }).select("id").single();
    ids.plan = p!.id;
  });
  afterAll(async () => {
    if (!db) return;
    if (ids.school) {
      await db.from("notifications").delete().eq("school_id", ids.school);
      await db.from("subscriptions").delete().eq("school_id", ids.school);
      await db.from("price_history").delete().eq("entity_id", ids.school);
      await db.from("schools").delete().eq("id", ids.school);
    }
    if (ids.plan) {
      await db.from("subscription_plans").delete().eq("id", ids.plan);
      await db.from("price_history").delete().eq("entity_id", ids.plan);
    }
  });

  const mine = async () => ((await db.from("notifications").select("kind, message").eq("school_id", ids.school!)).data ?? []);

  it("no reminder when renewal is more than 7 days away", async () => {
    await db.from("subscriptions").insert({ school_id: ids.school, plan_id: ids.plan, agreed_monthly_price: 900, started_on: today, renews_on: addDays(today, 20) });
    await sendRenewalReminders(db, today);
    expect(await mine()).toHaveLength(0);
  });

  it("one reminder 7 days before, with no price in it, and never twice", async () => {
    const renews = addDays(today, 7);
    await db.from("subscriptions").update({ renews_on: renews }).eq("school_id", ids.school!);
    await sendRenewalReminders(db, today);
    await sendRenewalReminders(db, today);
    const list = await mine();
    expect(list).toHaveLength(1);
    expect(list[0]!.kind).toBe("renewal_due");
    expect(list[0]!.message).not.toMatch(/₦|900|1000|1,000/);
    const { data: sub } = await db.from("subscriptions").select("reminded_for").eq("school_id", ids.school!).single();
    expect(sub!.reminded_for).toBe(renews);
  });

  it("suspended schools are not reminded", async () => {
    await db.from("notifications").delete().eq("school_id", ids.school!);
    await db.from("subscriptions").update({ renews_on: addDays(today, 3), suspended: true, reminded_for: null }).eq("school_id", ids.school!);
    await sendRenewalReminders(db, today);
    expect(await mine()).toHaveLength(0);
  });
});
