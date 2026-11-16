"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { idSchema } from "@/lib/validation";
import { checkRateLimitShared } from "@/lib/rate-limit-shared";
import { createCashier, newInvoiceReference, opayConfig } from "@/lib/opay";
import type { ActionState } from "@/components/forms/field";

/** Pays an unpaid invoice with OPay (card, bank transfer or USSD): opens OPay's payment page. School admins only. */
export async function payInvoiceOnline(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireArea("invoices");
  if (user.role !== "school_admin" || !user.schoolId) return { errors: { _form: "Only the school's admin can pay its invoices." } };
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { errors: { _form: "Invalid invoice." } };
  const cfg = opayConfig();
  if (!cfg) return { errors: { _form: "Online payment isn't switched on yet. Please pay by bank transfer." } };
  if (!(await checkRateLimitShared(`invpay:${user.id}`, { max: 10, windowMs: 60 * 60_000 })).ok) return { errors: { _form: "Too many tries. Please wait a little." } };

  // Read through RLS: the admin can only see their own school's invoices.
  const supabase = await createClient();
  const { data: inv } = await supabase.from("invoices").select("id, school_id, number, total, status").eq("id", id.data).maybeSingle();
  if (!inv || inv.school_id !== user.schoolId) return { errors: { _form: "Invoice not found." } };
  if (inv.status !== "issued") return { errors: { _form: inv.status === "paid" ? "This invoice is already paid." : "This invoice can't be paid." } };

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const reference = newInvoiceReference();
  const db = createAdminClient();
  const { error } = await db.from("invoice_payments").insert({ invoice_id: inv.id, school_id: inv.school_id, reference, amount: Number(inv.total), started_by: user.id });
  if (error) return { errors: { _form: "Could not start the payment. Please try again." } };

  const r = await createCashier(cfg, {
    reference, amountNaira: Number(inv.total), description: `Invoice ${inv.number}`,
    returnUrl: `${origin}/invoices/${inv.id}?paid=${reference}`, cancelUrl: `${origin}/invoices/${inv.id}`, callbackUrl: `${origin}/api/opay/callback`,
    user: { id: user.id, name: user.name, email: user.email }, clientIp: h.get("x-forwarded-for")?.split(",")[0]?.trim(),
  });
  if (!r.ok) {
    await db.from("invoice_payments").update({ status: "failed" }).eq("reference", reference);
    return { errors: { _form: `The payment page couldn't open (${r.error}). Please try again, or pay by bank transfer.` } };
  }
  await db.from("invoice_payments").update({ provider_order: r.orderNo }).eq("reference", reference);
  await writeAudit({ schoolId: inv.school_id, actorId: user.id, action: "billing.invoice_pay_started", entity: "invoices", entityId: inv.id, details: { reference, number: inv.number } });
  redirect(r.url);
}
