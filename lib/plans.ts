/**
 * Basic and Premium plans. The website sells them as "Starter" (Basic) and "Standard" (Premium).
 * Each feature names the lowest plan that includes it; locked features show "Upgrade to Premium".
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type Plan = "basic" | "premium";
export type Feature = "attendance" | "lessons" | "monthly_reports" | "pickup" | "whatsapp_assistant" | "emergency";

export const FEATURE_PLAN: Record<Feature, Plan> = {
  attendance: "basic",
  lessons: "basic",
  monthly_reports: "basic",
  pickup: "basic",
  whatsapp_assistant: "basic",
  emergency: "premium",
};

export const FEATURE_LABEL: Record<Feature, string> = {
  attendance: "Attendance",
  lessons: "Teacher lessons",
  monthly_reports: "Monthly teacher reports",
  pickup: "Safe pickup",
  whatsapp_assistant: "WhatsApp assistant",
  emergency: "Emergency roll call",
};

export const PLAN_LABEL: Record<Plan, string> = { basic: "Basic", premium: "Premium" };

export function isPlan(v: unknown): v is Plan {
  return v === "basic" || v === "premium";
}

export function planAllows(plan: Plan, feature: Feature): boolean {
  return plan === "premium" || FEATURE_PLAN[feature] === "basic";
}

/** The school's plan. Anything unexpected (or a database not yet updated) counts as Basic. */
export async function getSchoolPlan(db: SupabaseClient, schoolId: string | null): Promise<Plan> {
  if (!schoolId) return "basic";
  const { data, error } = await db.from("schools").select("plan").eq("id", schoolId).maybeSingle();
  if (error || !data) return "basic";
  return isPlan(data.plan) ? data.plan : "basic";
}
