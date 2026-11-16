"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimitShared } from "@/lib/rate-limit-shared";
import { normaliseNgPhone } from "@/lib/phone";
import { emailSchema, fieldErrors } from "@/lib/validation";
import { naira, quoteFor, webPlanFor } from "@/lib/pricing";
import { loadPricing } from "@/lib/pricing-data";
import { flutterwaveKey, initializePayment, newReference } from "@/lib/flutterwave";

export type PayState = { ok?: string; errors?: Record<string, string>; data?: unknown };

const phone = z.string().transform((v, ctx) => {
  const p = normaliseNgPhone(v);
  if (!p) { ctx.addIssue({ code: "custom", message: "Enter a Nigerian mobile number, like 0803 123 4567." }); return z.NEVER; }
  return p;
});
const method = z.enum(["card", "transfer", "ussd"], { message: "Choose how to pay." });

const orderSchema = z.object({
  plan: z.string().max(60).optional(),
  billing: z.enum(["monthly", "annual"]),
  school_name: z.string().trim().min(2, "Enter the school's name.").max(160),
  students: z.coerce.number({ message: "Enter how many students." }).int("Enter a whole number.").min(1, "Enter how many students.").max(20000, "For more than 20,000 students, talk to us."),
  contact_name: z.string().trim().min(2, "Enter your name.").max(120),
  phone,
  email: emailSchema,
  state: z.string().trim().min(2, "Choose your state.").max(40),
  method,
});

async function origin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
}
async function ip() {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** A school buying a plan: pay now (Flutterwave), or an invoice/quote when online payment or a price isn't set. */
export async function placeOrder(_prev: PayState, formData: FormData): Promise<PayState> {
  const parsed = orderSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  if (!(await checkRateLimitShared(`order:${await ip()}`, { max: 6, windowMs: 60 * 60_000 })).ok) {
    return { errors: { _form: "We've received several orders from here already. We'll be in touch soon." } };
  }
  const o = parsed.data;
  const pricing = await loadPricing();
  const fits = webPlanFor(pricing, o.students);
  const chosen = pricing.plans.find((p) => p.id === o.plan) ?? null;
  if (chosen && fits && chosen.id !== fits.id) return { errors: { students: `For ${o.students.toLocaleString()} students, choose ${fits.name} (${fits.range}).` } };
  const plan = chosen ?? fits;
  const quote = plan ? quoteFor(plan.id, o.billing, o.students, pricing) : null;
  const reference = newReference("SCH");
  const key = flutterwaveKey();
  const db = createAdminClient();
  const { error } = await db.from("orders").insert({
    reference, plan: plan?.name ?? "To be agreed", plan_id: plan?.id ?? null, billing: o.billing, students: o.students, school_name: o.school_name, contact_name: o.contact_name,
    phone: o.phone, email: o.email, state: o.state, method: o.method, amount: quote?.due ?? null, status: quote ? "pending" : "quote",
  });
  if (error) return { errors: { _form: "Something went wrong saving your order. Please try again." } };

  if (!quote) return { ok: `Thank you. We'll send a quote for ${o.school_name} to ${o.email} and call you on the number you gave.` };
  if (!key) return { ok: `Thank you. We'll email an invoice for ${naira(quote.due)} to ${o.email}, with bank details, and a quote for the setup. Reference ${reference}.` };

  const init = await initializePayment({
    key, email: o.email, phone: o.phone, name: o.contact_name, amount: quote.due, reference, method: o.method,
    redirectUrl: `${await origin()}/pricing/done?ref=${reference}`,
    meta: { kind: "school_order", school: o.school_name, plan: quote.plan.name, billing: o.billing, students: o.students },
  });
  if (!init.ok) return { errors: { _form: `The payment page couldn't open: ${init.error}. Your order is saved; we'll send an invoice instead.` } };
  redirect(init.url);
}
