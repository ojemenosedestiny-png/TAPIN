import { cacheLife, cacheTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_PRICING, pricingFrom, type ItemRowIn, type PlanRowIn, type WebPricing } from "@/lib/pricing";

export const PRICING_TAG = "web-pricing";

/**
 * The website's plans, setup prices and contact details, as the super admin set them on the Pricing and Billing pages.
 * Cached (pages stay fast); saving a price expires the cache at once with updateTag(PRICING_TAG).
 */
export async function loadPricing(): Promise<WebPricing> {
  "use cache";
  cacheTag(PRICING_TAG);
  cacheLife("hours");
  try {
    const db = createAdminClient();
    const [{ data: plans, error }, { data: items }, { data: settings }] = await Promise.all([
      db.from("subscription_plans").select("id, name, min_students, max_students, monthly_price, features, active, sort").eq("active", true).order("sort"),
      db.from("price_items").select("name, unit, unit_price, description, active").eq("active", true).order("sort"),
      db.from("platform_settings").select("annual_free_months, live_within_days, phone, email, whatsapp").eq("id", true).maybeSingle(),
    ]);
    if (error) return DEFAULT_PRICING;
    return pricingFrom((plans ?? []) as PlanRowIn[], (items ?? []) as ItemRowIn[], settings);
  } catch {
    return DEFAULT_PRICING; // database unreachable: show "prices on request" rather than fail the page
  }
}
