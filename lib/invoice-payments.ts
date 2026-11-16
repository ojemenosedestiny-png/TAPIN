/**
 * Settling an online invoice payment (server only). Called when the payer comes back from OPay, from OPay's
 * callback, and from the invoice page: always asks OPay, never trusts who called.
 * Paid → the payment, its invoice, and (for a card/kiosk order) the order are marked paid.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { opayConfig, opayPaid, queryCashier } from "@/lib/opay";

export type InvoicePayStatus = "paid" | "pending" | "failed" | "cancelled" | "unknown";

export async function settleInvoicePayment(reference: string): Promise<{ status: InvoicePayStatus; invoiceId: string | null }> {
  if (!/^TAPIN-INV-[0-9A-F]{12}$/.test(reference)) return { status: "unknown", invoiceId: null };
  const db = createAdminClient();
  const { data: p } = await db.from("invoice_payments").select("id, invoice_id, school_id, amount, status").eq("reference", reference).maybeSingle();
  if (!p) return { status: "unknown", invoiceId: null };
  if (p.status !== "pending") return { status: p.status as InvoicePayStatus, invoiceId: p.invoice_id };
  const cfg = opayConfig();
  if (!cfg) return { status: "pending", invoiceId: p.invoice_id };

  const s = await queryCashier(cfg, reference);
  const now = new Date().toISOString();
  if (opayPaid(s, reference, Number(p.amount))) {
    const { data: moved } = await db.from("invoice_payments").update({ status: "paid", paid_at: now, provider_order: s!.orderNo })
      .eq("id", p.id).eq("status", "pending").select("id");
    if (moved?.length) {
      await db.from("invoices").update({ status: "paid", paid_at: now }).eq("id", p.invoice_id).eq("status", "issued");
      await db.from("school_orders").update({ status: "paid", paid_at: now }).eq("invoice_id", p.invoice_id).eq("status", "awaiting_payment");
      await db.from("audit_logs").insert({ school_id: p.school_id, actor_id: null, action: "billing.invoice_paid_online", entity: "invoices", entity_id: p.invoice_id, details: { reference, amount: Number(p.amount), provider: "opay" } });
    }
    return { status: "paid", invoiceId: p.invoice_id };
  }
  if (s && (s.status === "FAIL" || s.status === "CLOSE")) {
    await db.from("invoice_payments").update({ status: s.status === "FAIL" ? "failed" : "cancelled" }).eq("id", p.id).eq("status", "pending");
    return { status: s.status === "FAIL" ? "failed" : "cancelled", invoiceId: p.invoice_id };
  }
  return { status: "pending", invoiceId: p.invoice_id };
}
