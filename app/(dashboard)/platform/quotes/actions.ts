"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireArea } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { fieldErrors, idSchema } from "@/lib/validation";
import { addDays, computeQuote, quoteNumber } from "@/lib/subscriptions";
import type { ActionState } from "@/components/forms/field";

const schema = z.object({
  school_id: z.union([idSchema, z.literal("")]).optional().transform((v) => v || null),
  school_name: z.string().trim().max(160).optional(),
  plan_id: idSchema,
  billing: z.enum(["monthly", "annual"]),
  discount_kind: z.enum(["", "percent", "fixed"]).optional().transform((v) => (v ? v : null)),
  discount_value: z.union([z.literal(""), z.coerce.number().min(0, "Can't be negative.").max(100_000_000)]).optional().transform((v) => (v === "" || v === undefined ? null : v)),
  discount_note: z.string().trim().max(300).optional().transform((v) => v || null),
  valid_days: z.coerce.number().int().min(1).max(180).default(30),
});

/**
 * Saves a quote at today's prices (read from the database, never from the browser), then opens it.
 * Quantities come as qty_<item id>.
 */
export async function saveQuote(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireArea("platform");
  const parsed = schema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const v = parsed.data;
  if (v.discount_kind === "percent" && (v.discount_value ?? 0) > 100) return { errors: { discount_value: "A percentage can't be over 100." } };
  if (v.discount_kind && v.discount_value === null) return { errors: { discount_value: "Enter the discount, or choose No discount." } };

  const db = createAdminClient();
  const [{ data: plan }, { data: items }, { data: settings }, school] = await Promise.all([
    db.from("subscription_plans").select("id, name, monthly_price, active").eq("id", v.plan_id).maybeSingle(),
    db.from("price_items").select("id, name, unit, unit_price").eq("active", true),
    db.from("platform_settings").select("annual_free_months").eq("id", true).maybeSingle(),
    v.school_id ? db.from("schools").select("id, name").eq("id", v.school_id).maybeSingle().then((r) => r.data) : Promise.resolve(null),
  ]);
  if (!plan || !plan.active) return { errors: { plan_id: "Choose an active plan." } };
  const schoolName = school?.name ?? v.school_name ?? "";
  if (schoolName.trim().length < 2) return { errors: { school_name: "Choose a school, or type the school's name." } };

  const quantities = (items ?? []).map((i) => {
    const q = Number(fd.get(`qty_${i.id}`) ?? 0);
    return { id: i.id as string, name: i.name as string, unit: i.unit as string, unit_price: Number(i.unit_price), quantity: Number.isFinite(q) && q > 0 ? Math.min(100_000, Math.floor(q)) : 0 };
  });
  const totals = computeQuote({
    items: quantities, monthlyPrice: Number(plan.monthly_price), billing: v.billing, annualFreeMonths: (settings?.annual_free_months as number | undefined) ?? 0,
    discount: v.discount_kind && v.discount_value !== null ? { kind: v.discount_kind, value: v.discount_value } : null,
  });

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
  const year = Number(today.slice(0, 4));
  let id: string | null = null;
  for (let attempt = 0; attempt < 5 && !id; attempt++) {
    const { count } = await db.from("quotes").select("id", { count: "exact", head: true }).like("number", `Q-${year}-%`);
    const { data, error } = await db.from("quotes").insert({
      number: quoteNumber(year, (count ?? 0) + 1 + attempt), school_id: school?.id ?? null, school_name: schoolName.trim(), plan_id: plan.id, plan_name: plan.name,
      monthly_price: Number(plan.monthly_price), billing: v.billing, lines: totals.lines, setup_total: totals.setupTotal,
      discount_kind: v.discount_kind && v.discount_value !== null ? v.discount_kind : null, discount_value: v.discount_kind ? v.discount_value : null,
      discount_note: v.discount_note, discount_amount: totals.discountAmount, first_payment: totals.firstPayment,
      valid_until: addDays(today, v.valid_days), created_by: user.id,
    }).select("id").single();
    if (data) id = data.id as string;
    else if (error?.code !== "23505") return { errors: { _form: "Could not save the quote. Please try again." } };
  }
  if (!id) return { errors: { _form: "Could not number the quote. Please try again." } };
  await writeAudit({ schoolId: school?.id ?? null, actorId: user.id, action: "quote.create", entity: "quotes", entityId: id, details: { school: schoolName, plan: plan.name, first_payment: totals.firstPayment } });
  revalidatePath("/platform/quotes");
  redirect(`/platform/quotes/${id}`);
}
