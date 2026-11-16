"use server";

import { revalidatePath } from "next/cache";
import { requireSchoolArea } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { idSchema } from "@/lib/validation";
import { canMove, orderInvoiceNumber, orderLines, type OrderStatus } from "@/lib/school-orders";
import type { ActionState } from "@/components/forms/field";

/**
 * A school admin orders more cards, wristbands or kiosks. Prices are read from the database (never the browser).
 * An invoice is made at once, with the bank details on it; TapIn marks it paid and then delivered.
 */
export async function placeSchoolOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("orders");
  const note = String(fd.get("note") ?? "").trim().slice(0, 500) || null;
  const db = createAdminClient();
  const [{ data: items }, { data: settings }, { count: open }] = await Promise.all([
    db.from("price_items").select("id, name, unit, unit_price").eq("active", true).gt("unit_price", 0),
    db.from("platform_settings").select("invoice_prefix").eq("id", true).maybeSingle(),
    db.from("school_orders").select("id", { count: "exact", head: true }).eq("school_id", user.schoolId).eq("status", "awaiting_payment"),
  ]);
  if ((open ?? 0) >= 5) return { errors: { _form: "You have 5 orders waiting for payment. Pay or cancel one before ordering again." } };
  const qty: Record<string, number> = {};
  for (const i of items ?? []) qty[i.id] = Number(fd.get(`qty_${i.id}`) ?? 0);
  const { lines, total } = orderLines((items ?? []).map((i) => ({ ...i, unit_price: Number(i.unit_price) })), qty);
  if (!lines.length) return { errors: { _form: "Choose how many of at least one item." } };

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
  const period = `${today.slice(0, 7)}-01`;
  const prefix = (settings?.invoice_prefix as string | undefined) ?? "TAP";
  let invoiceId: string | null = null;
  for (let attempt = 0; attempt < 5 && !invoiceId; attempt++) {
    const { count } = await db.from("invoices").select("id", { count: "exact", head: true }).eq("kind", "order").eq("period", period);
    const { data, error } = await db.from("invoices").insert({
      school_id: user.schoolId, kind: "order", period, total, number: orderInvoiceNumber(prefix, period, (count ?? 0) + 1 + attempt),
      lines: lines.map(({ description, quantity, unit_price, amount }) => ({ description, quantity, unit_price, amount })),
    }).select("id").single();
    if (data) invoiceId = data.id as string;
    else if (error?.code !== "23505") return { errors: { _form: "Could not create the invoice. Please try again." } };
  }
  if (!invoiceId) return { errors: { _form: "Could not number the invoice. Please try again." } };

  const { data: order, error } = await db.from("school_orders")
    .insert({ school_id: user.schoolId, invoice_id: invoiceId, lines, total, note, requested_by: user.id }).select("id").single();
  if (error || !order) {
    await db.from("invoices").update({ status: "void" }).eq("id", invoiceId);
    return { errors: { _form: "Could not save the order. Please try again." } };
  }
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "school_order.place", entity: "school_orders", entityId: order.id, details: { total, items: lines.length } });
  revalidatePath("/orders");
  return { ok: "Order placed. Your invoice is ready with the bank details.", data: { invoiceId } };
}

/** The school cancels an order it hasn't paid for yet; its invoice is voided. */
export async function cancelSchoolOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("orders");
  const id = idSchema.safeParse(fd.get("id"));
  if (!id.success) return { errors: { _form: "Invalid request." } };
  const db = createAdminClient();
  const { data: o } = await db.from("school_orders").select("status, invoice_id").eq("id", id.data).eq("school_id", user.schoolId).maybeSingle();
  if (!o || !canMove(o.status as OrderStatus, "cancelled", "school")) return { errors: { _form: "This order can't be cancelled now. Contact TapIn." } };
  const { error } = await db.from("school_orders").update({ status: "cancelled" }).eq("id", id.data).eq("status", "awaiting_payment");
  if (error) return { errors: { _form: "Could not cancel." } };
  if (o.invoice_id) await db.from("invoices").update({ status: "void" }).eq("id", o.invoice_id).eq("status", "issued");
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "school_order.cancelled", entity: "school_orders", entityId: id.data, details: {} });
  revalidatePath("/orders");
  return { ok: "Order cancelled." };
}
