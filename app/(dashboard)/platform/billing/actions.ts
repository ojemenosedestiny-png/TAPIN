"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArea } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { invoiceLines, invoiceNumber, monthLabel, toPeriod } from "@/lib/billing";
import { fieldErrors } from "@/lib/validation";
import type { ActionState } from "@/components/forms/field";

const money = z.coerce.number().min(0, "Can't be negative.").max(100_000_000);

const pricingSchema = z.object({
  school_id: z.string().uuid(),
  price_per_student: money,
  setup_fee: money,
  price_per_sms: money,
  billing_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => v || null),
  billing_email: z.string().trim().email("Enter a valid email.").optional().or(z.literal("")).transform((v) => v || null),
});

export async function saveSchoolPricing(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireArea("platform");
  const parsed = pricingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { school_id, ...pricing } = parsed.data;
  const { error } = await createAdminClient().from("schools").update(pricing).eq("id", school_id);
  if (error) return { errors: { _form: "Could not save pricing." } };
  await writeAudit({ schoolId: school_id, actorId: user.id, action: "billing.pricing", entity: "schools", entityId: school_id, details: pricing });
  revalidatePath("/platform/billing");
  return { ok: "Pricing saved." };
}

const platformSchema = z.object({
  business_name: z.string().trim().min(2).max(120),
  address: z.string().trim().max(300).optional().transform((v) => v || null),
  email: z.string().trim().email("Enter a valid email.").optional().or(z.literal("")).transform((v) => v || null),
  phone: z.string().trim().max(40).optional().transform((v) => v || null),
  bank_details: z.string().trim().max(300).optional().transform((v) => v || null),
  invoice_prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,8}$/, "2–8 letters or numbers, e.g. TAP."),
});

export async function savePlatformSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireArea("platform");
  const parsed = platformSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { error } = await createAdminClient().from("platform_settings").update({ ...parsed.data, updated_at: new Date().toISOString() }).eq("id", true);
  if (error) return { errors: { _form: "Could not save." } };
  await writeAudit({ schoolId: null, actorId: user.id, action: "billing.platform_settings", entity: "platform_settings" });
  revalidatePath("/platform/billing");
  return { ok: "Business details saved. They appear on every invoice." };
}

/**
 * Issues one invoice per school for a month: schools with pricing set, whose billing started by the
 * end of that month, and that don't already have an invoice for it. The first invoice adds the setup fee.
 */
export async function generateInvoices(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireArea("platform");
  const period = toPeriod(String(formData.get("period") ?? ""));
  if (!period) return { errors: { _form: "Choose a month." } };
  const only = z.string().uuid().safeParse(formData.get("school_id"));
  const onlySchool = only.success ? only.data : null; // empty = every school
  const db = createAdminClient();
  const monthEnd = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).toISOString().slice(0, 10);

  const [{ data: schools }, { data: usage }, { data: settings }, { data: existing }] = await Promise.all([
    db.from("schools").select("id, name, price_per_student, setup_fee, price_per_sms, billing_start"),
    db.rpc("school_usage", { p_month: period }),
    db.from("platform_settings").select("invoice_prefix").eq("id", true).single(),
    db.from("invoices").select("school_id, period"),
  ]);
  const usageBy = new Map(((usage ?? []) as { school_id: string; active_students: number; sms_sent: number }[]).map((u) => [u.school_id, u]));
  const hasThisMonth = new Set((existing ?? []).filter((i) => i.period === period).map((i) => i.school_id));
  const hasAny = new Set((existing ?? []).map((i) => i.school_id));
  let seq = (existing ?? []).filter((i) => i.period === period).length;
  let issued = 0;

  for (const s of schools ?? []) {
    if (onlySchool && s.id !== onlySchool) continue;
    if (hasThisMonth.has(s.id) || !s.billing_start || s.billing_start > monthEnd) continue;
    const pricing = { price_per_student: Number(s.price_per_student), setup_fee: Number(s.setup_fee), price_per_sms: Number(s.price_per_sms) };
    const { lines, total } = invoiceLines(pricing, usageBy.get(s.id) ?? { active_students: 0, sms_sent: 0 }, { period, firstInvoice: !hasAny.has(s.id) });
    if (!lines.length) continue;
    seq += 1;
    const { error } = await db.from("invoices").insert({
      school_id: s.id, period, lines, total, number: invoiceNumber(settings?.invoice_prefix ?? "TAP", period, seq),
    });
    if (error) {
      if (error.code === "23505") continue; // another admin issued it at the same moment
      return { errors: { _form: `Stopped at ${s.name}: ${error.message}` } };
    }
    issued++;
  }
  await writeAudit({ schoolId: null, actorId: user.id, action: "billing.generate", entity: "invoices", details: { period, issued, school_id: onlySchool } });
  revalidatePath("/platform/billing");
  return { ok: issued ? `${issued} invoice${issued === 1 ? "" : "s"} issued for ${monthLabel(period)}.` : `Nothing new to invoice for ${monthLabel(period)}.` };
}

export async function setInvoiceStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireArea("platform");
  const id = z.string().uuid().safeParse(formData.get("id"));
  const status = z.enum(["paid", "void", "issued"]).safeParse(formData.get("status"));
  if (!id.success || !status.success) return { errors: { _form: "Invalid request." } };
  const { data, error } = await createAdminClient().from("invoices")
    .update({ status: status.data, paid_at: status.data === "paid" ? new Date().toISOString() : null })
    .eq("id", id.data).select("number, school_id").single();
  if (error || !data) return { errors: { _form: "Could not update the invoice." } };
  await writeAudit({ schoolId: data.school_id, actorId: user.id, action: `billing.invoice_${status.data}`, entity: "invoices", entityId: id.data, details: { number: data.number } });
  revalidatePath("/platform/billing");
  return { ok: `Invoice ${data.number} marked ${status.data}.` };
}
