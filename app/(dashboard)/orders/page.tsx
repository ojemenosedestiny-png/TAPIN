import type { Metadata } from "next";
import Link from "next/link";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { naira } from "@/lib/pricing";
import { STATUS_LABEL, type OrderLine, type OrderStatus } from "@/lib/school-orders";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusPill } from "@/components/dashboard/status-pill";
import { CancelOrderButton, OrderForm } from "./order-form";

export const metadata: Metadata = { title: "Order cards and kiosks" };

const TONE: Record<OrderStatus, "amber" | "teal" | "green" | "slate"> = { awaiting_payment: "amber", paid: "teal", delivered: "green", cancelled: "slate" };

/** School admin: buy more cards, wristbands or kiosks. The school pays by invoice. */
export default async function OrdersPage() {
  const user = await requireSchoolArea("orders");
  const supabase = await createClient(); // RLS: this school's orders only
  // Setup prices are TapIn's list (super admin only in the database); a school sees the active, priced items here.
  const [{ data: items }, { data: orders }] = await Promise.all([
    createAdminClient().from("price_items").select("id, name, unit, unit_price, description").eq("active", true).gt("unit_price", 0).order("sort"),
    supabase.from("school_orders").select("id, lines, total, status, note, created_at, invoice_id").eq("school_id", user.schoolId).order("created_at", { ascending: false }).limit(30),
  ]);
  const list = (items ?? []).map((i) => ({ ...i, unit_price: Number(i.unit_price) }));

  return (
    <>
      <PageHeader title="Order cards and kiosks" description="New pupils, lost cards or another gate: order here. You get an invoice straight away." />

      <section className="motion-rise surface rounded-xl p-5" aria-labelledby="new-order">
        <h2 id="new-order" className="mb-4 text-base font-semibold text-ink">New order</h2>
        {list.length === 0 ? <p className="text-sm text-muted-foreground">Ordering isn&apos;t open yet. Please contact TapIn for cards or kiosks.</p> : <OrderForm items={list} />}
      </section>

      <section className="motion-rise mt-6 surface rounded-xl p-5" aria-labelledby="past-orders">
        <h2 id="past-orders" className="mb-3 text-base font-semibold text-ink">Your orders</h2>
        {(orders ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No orders yet.</p> : (
          <ul className="divide-y divide-border">
            {(orders ?? []).map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{(o.lines as OrderLine[]).map((l) => `${l.quantity} × ${l.description.replace(/ \(.*\)$/, "")}`).join(", ")}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(o.created_at).toLocaleDateString("en-NG", { dateStyle: "medium", timeZone: "Africa/Lagos" })} · {naira(Number(o.total))}{o.note ? ` · ${o.note}` : ""}
                  </p>
                </div>
                <StatusPill tone={TONE[o.status as OrderStatus]}>{STATUS_LABEL[o.status as OrderStatus]}</StatusPill>
                {o.invoice_id && o.status !== "cancelled" && <Link href={`/invoices/${o.invoice_id}`} className="text-sm font-medium text-brand hover:underline">Invoice</Link>}
                {o.status === "awaiting_payment" && <CancelOrderButton id={o.id} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
