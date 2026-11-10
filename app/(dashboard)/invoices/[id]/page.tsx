import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { monthLabel, naira, type InvoiceLine } from "@/lib/billing";
import { Wordmark } from "@/components/brand/logo";
import { StatusPill } from "@/components/dashboard/status-pill";
import { PrintButton } from "@/app/(dashboard)/reports/print-button";

export const metadata: Metadata = { title: "Invoice" };

/** One invoice, printable as a PDF. Super admin, or the school's own admin (RLS). */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireArea("invoices");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: inv }, { data: seller }] = await Promise.all([
    supabase.from("invoices").select("id, school_id, number, period, lines, total, status, issued_at, paid_at").eq("id", id).maybeSingle(),
    supabase.from("platform_settings").select("*").eq("id", true).maybeSingle(),
  ]);
  if (!inv) notFound();
  const { data: school } = await supabase.from("schools").select("name, billing_email").eq("id", inv.school_id).maybeSingle();
  const lines = inv.lines as InvoiceLine[];
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });

  return (
    <>
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href={user.role === "super_admin" ? "/platform/billing" : "/settings"} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-ink">
          <ArrowLeft className="size-4" /> {user.role === "super_admin" ? "Billing" : "Settings"}
        </Link>
        <PrintButton />
      </div>

      <article className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-8 text-sm text-ink print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <Wordmark className="text-base" />
            <div className="mt-3 space-y-0.5 text-muted-foreground">
              <p className="font-medium text-ink">{seller?.business_name ?? "TapIn"}</p>
              {seller?.address && <p>{seller.address}</p>}
              {seller?.email && <p>{seller.email}</p>}
              {seller?.phone && <p>{seller.phone}</p>}
            </div>
          </div>
          <div className="text-right">
            <h1 className="font-heading text-2xl font-semibold">Invoice</h1>
            <p className="mt-1 font-medium tabular-nums">{inv.number}</p>
            <p className="text-muted-foreground">Issued {date(inv.issued_at)}</p>
            <div className="mt-2">
              {inv.status === "paid" ? <StatusPill tone="green">Paid {inv.paid_at ? date(inv.paid_at) : ""}</StatusPill>
                : inv.status === "void" ? <StatusPill tone="slate">Void</StatusPill> : <StatusPill tone="amber">Due</StatusPill>}
            </div>
          </div>
        </header>

        <section className="mt-8">
          <p className="text-muted-foreground">Bill to</p>
          <p className="font-medium">{school?.name ?? "—"}</p>
          {school?.billing_email && <p className="text-muted-foreground">{school.billing_email}</p>}
          <p className="mt-2 text-muted-foreground">Period: {monthLabel(inv.period)}</p>
        </section>

        <table className="mt-8 w-full">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="py-2 font-normal">Description</th>
              <th scope="col" className="py-2 text-right font-normal">Qty</th>
              <th scope="col" className="py-2 text-right font-normal">Unit price</th>
              <th scope="col" className="py-2 text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-border">
                <td className="py-3 pr-4">{l.description}</td>
                <td className="py-3 text-right tabular-nums">{l.quantity.toLocaleString()}</td>
                <td className="py-3 text-right tabular-nums">{naira(l.unit_price)}</td>
                <td className="py-3 text-right tabular-nums">{naira(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-4 text-right font-medium">Total</td>
              <td className="pt-4 text-right font-heading text-lg font-semibold tabular-nums">{naira(Number(inv.total))}</td>
            </tr>
          </tfoot>
        </table>

        {seller?.bank_details && inv.status !== "paid" && (
          <section className="mt-10 rounded-lg bg-muted/60 p-4">
            <p className="font-medium">How to pay</p>
            <p className="mt-1 text-muted-foreground">{seller.bank_details}</p>
            <p className="mt-1 text-muted-foreground">Please use <span className="font-medium text-ink tabular-nums">{inv.number}</span> as the payment reference.</p>
          </section>
        )}
      </article>
    </>
  );
}
