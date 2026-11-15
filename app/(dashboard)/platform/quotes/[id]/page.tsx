import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { naira } from "@/lib/pricing";
import type { QuoteLine } from "@/lib/subscriptions";
import { Wordmark } from "@/components/brand/logo";
import { PrintButton } from "@/app/(dashboard)/reports/print-button";

export const metadata: Metadata = { title: "Quote" };

const long = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" });

/** One quote, branded and printable: "PDF / Print" → Save as PDF. Super admin only. */
export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireArea("platform");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: q }, { data: seller }] = await Promise.all([
    supabase.from("quotes").select("*").eq("id", id).maybeSingle(),
    supabase.from("platform_settings").select("*").eq("id", true).maybeSingle(),
  ]);
  if (!q) notFound();
  const lines = (q.lines ?? []) as QuoteLine[];
  const annual = q.billing === "annual";
  const periodFee = Number(q.first_payment) + Number(q.discount_amount) - Number(q.setup_total);
  const monthly = Number(q.monthly_price);
  const freeMonths = annual && monthly > 0 ? Math.round(12 - periodFee / monthly) : 0;

  return (
    <>
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href="/platform/quotes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-ink"><ArrowLeft className="size-4" /> Quotes</Link>
        <PrintButton />
      </div>

      <article className="mx-auto max-w-3xl surface rounded-xl p-8 text-sm text-ink print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-border pb-6">
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
            <h1 className="font-heading text-2xl font-semibold">Quote</h1>
            <p className="mt-1 font-medium tabular-nums">{q.number}</p>
            <p className="text-muted-foreground">Date: {long(q.created_at)}</p>
            <p className="text-muted-foreground">Valid until: {long(q.valid_until)}</p>
          </div>
        </header>

        <section className="mt-6">
          <p className="text-muted-foreground">Prepared for</p>
          <p className="text-base font-medium">{q.school_name}</p>
        </section>

        <table className="mt-6 w-full">
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
                <td className="py-3 pr-4">{l.name} <span className="text-muted-foreground">({l.unit})</span></td>
                <td className="py-3 text-right tabular-nums">{l.quantity.toLocaleString()}</td>
                <td className="py-3 text-right tabular-nums">{naira(l.unit_price)}</td>
                <td className="py-3 text-right tabular-nums">{naira(l.amount)}</td>
              </tr>
            ))}
            <tr className="border-b border-border">
              <td className="py-3 pr-4">
                {q.plan_name} plan, {annual ? "first year" : "first month"}
                <span className="block text-xs text-muted-foreground">{annual ? `12 months for the price of ${12 - freeMonths}` : "Billed monthly"} · {naira(monthly)} per month</span>
              </td>
              <td className="py-3 text-right tabular-nums">{annual ? 12 - freeMonths : 1}</td>
              <td className="py-3 text-right tabular-nums">{naira(monthly)}</td>
              <td className="py-3 text-right tabular-nums">{naira(periodFee)}</td>
            </tr>
          </tbody>
        </table>

        <dl className="ml-auto mt-4 w-full max-w-xs space-y-1.5">
          <div className="flex justify-between"><dt className="text-muted-foreground">Setup (one time)</dt><dd className="tabular-nums">{naira(Number(q.setup_total))}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">{annual ? "First year" : "First month"}</dt><dd className="tabular-nums">{naira(periodFee)}</dd></div>
          {Number(q.discount_amount) > 0 && (
            <div className="flex justify-between"><dt className="text-muted-foreground">Discount{q.discount_kind === "percent" ? ` (${Number(q.discount_value)}%)` : ""}</dt><dd className="tabular-nums">−{naira(Number(q.discount_amount))}</dd></div>
          )}
          <div className="flex justify-between border-t border-border pt-2 text-base font-semibold"><dt>First payment</dt><dd className="tabular-nums">{naira(Number(q.first_payment))}</dd></div>
          <div className="flex justify-between text-xs text-muted-foreground"><dt>Then</dt><dd className="tabular-nums">{annual ? `${naira(periodFee)} per year` : `${naira(monthly)} per month`}</dd></div>
        </dl>
        {q.discount_note && <p className="mt-4 text-xs text-muted-foreground">Discount: {q.discount_note}</p>}

        <footer className="mt-10 border-t border-border pt-4 text-xs text-muted-foreground">
          <p>Prices in Nigerian naira. This quote is valid until {long(q.valid_until)}. The monthly price agreed here stays the same for your school until you agree a change with us.</p>
        </footer>
      </article>
    </>
  );
}
