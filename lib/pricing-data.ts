import { cacheLife, cacheTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_PRICING, pricingFrom, type WebPricing } from "@/lib/pricing";

export const PRICING_TAG = "web-pricing";

/**
 * The website's prices and contact details, as the super admin set them on the Billing page.
 * Cached (pages stay fast); saving the form expires the cache at once with updateTag(PRICING_TAG).
 */
export async function loadPricing(): Promise<WebPricing> {
  "use cache";
  cacheTag(PRICING_TAG);
  cacheLife("hours");
  try {
    const { data } = await createAdminClient().from("platform_settings")
      .select("starter_price, standard_price, web_setup_fee, yearly_discount_pct, live_within_days, phone, email, whatsapp")
      .eq("id", true).maybeSingle();
    return pricingFrom(data);
  } catch {
    return DEFAULT_PRICING; // database unreachable: show "price on request" rather than fail the page
  }
}
