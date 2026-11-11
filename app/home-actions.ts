"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimitShared } from "@/lib/rate-limit-shared";
import { demoRequestSchema } from "@/lib/demo";
import { fieldErrors } from "@/lib/validation";
import type { ActionState } from "@/components/forms/field";

/** Saves a "Book a demo" slip from the public home page. The super admin sees it on the Schools page. */
export async function requestDemo(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = demoRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    if (errors.website) return { ok: "Thank you. We'll call you to arrange a visit." }; // a bot: say thanks, save nothing
    return { errors };
  }
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await checkRateLimitShared(`demo:${ip}`, { max: 5, windowMs: 60 * 60_000 })).ok) {
    return { errors: { _form: "We've already received a few requests from here. We'll be in touch soon." } };
  }
  const { name, school, phone, pupils } = parsed.data;
  const { error } = await createAdminClient().from("demo_requests").insert({ name, school, phone, pupils });
  if (error) return { errors: { _form: "Something went wrong sending the slip. Please try again." } };
  return { ok: `Thank you, ${name}. We'll call you to arrange a visit to ${school}.` };
}
