/** Marks an order or parent payment as paid, once Flutterwave confirms it for the right amount. Server only. */
import { createAdminClient } from "@/lib/supabase/admin";
import { flutterwaveKey, verifyPayment } from "@/lib/flutterwave";

export type Settled =
  | { kind: "school"; status: "paid" | "pending" | "failed" | "quote" | "cancelled"; amount: number | null; schoolName: string; email: string }
  | { kind: "parent"; status: "paid" | "pending" | "failed"; amount: number }
  | null;

/** Looks the reference up, asks Flutterwave (never trusts the browser), and records the result. */
export async function settlePayment(reference: string): Promise<Settled> {
  if (!/^TAPIN-(SCH|PAR)-[0-9A-F]{12}$/.test(reference)) return null;
  const db = createAdminClient();
  const key = flutterwaveKey();
  const now = new Date().toISOString();

  if (reference.startsWith("TAPIN-SCH-")) {
    const { data: o } = await db.from("orders").select("status, amount, school_name, email").eq("reference", reference).maybeSingle();
    if (!o) return null;
    let status = o.status as "paid" | "pending" | "failed" | "quote" | "cancelled";
    if (status === "pending" && key && o.amount !== null) {
      const v = await verifyPayment(key, reference);
      if (v?.paid && Math.abs(v.amount - Number(o.amount)) < 0.01) {
        await db.from("orders").update({ status: "paid", paid_at: now }).eq("reference", reference).eq("status", "pending");
        status = "paid";
      }
    }
    return { kind: "school", status, amount: o.amount === null ? null : Number(o.amount), schoolName: o.school_name, email: o.email };
  }

  const { data: p } = await db.from("parent_payments").select("status, amount").eq("reference", reference).maybeSingle();
  if (!p) return null;
  let status = p.status as "paid" | "pending" | "failed";
  if (status === "pending" && key) {
    const v = await verifyPayment(key, reference);
    if (v?.paid && Math.abs(v.amount - Number(p.amount)) < 0.01) {
      await db.from("parent_payments").update({ status: "paid", paid_at: now }).eq("reference", reference).eq("status", "pending");
      status = "paid";
    }
  }
  return { kind: "parent", status, amount: Number(p.amount) };
}
