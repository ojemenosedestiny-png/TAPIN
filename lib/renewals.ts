import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/subscriptions";

/**
 * Daily: a school whose plan renews within 7 days (and is not suspended) gets one notification for that
 * renewal date, shown to its admins. No price is ever included. reminded_for stops repeats.
 */
export async function sendRenewalReminders(db: SupabaseClient, today: string): Promise<number> {
  const { data: subs } = await db.from("subscriptions")
    .select("school_id, renews_on, reminded_for, subscription_plans(name)")
    .eq("suspended", false).lte("renews_on", addDays(today, 7)).gte("renews_on", today);
  let sent = 0;
  for (const s of subs ?? []) {
    if (s.reminded_for === s.renews_on) continue;
    const plan = (s.subscription_plans as unknown as { name: string } | null)?.name ?? "TapIn";
    const when = new Date(`${s.renews_on}T12:00:00Z`).toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long" });
    const { error } = await db.from("notifications").insert({
      school_id: s.school_id, kind: "renewal_due", dedupe_key: `renewal:${s.school_id}:${s.renews_on}`,
      message: `Your TapIn ${plan} plan renews on ${when}. Please arrange payment with TapIn to keep everything running.`,
    });
    // 23505 = already sent for this date; mark it either way.
    if (!error || error.code === "23505") {
      await db.from("subscriptions").update({ reminded_for: s.renews_on }).eq("school_id", s.school_id);
      if (!error) sent++;
    }
  }
  return sent;
}
