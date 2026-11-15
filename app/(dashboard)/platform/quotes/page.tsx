import type { Metadata } from "next";
import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { naira } from "@/lib/pricing";
import { PageHeader } from "@/components/dashboard/page-header";
import { QuoteBuilder } from "./builder";

export const metadata: Metadata = { title: "Quotes" };

/** Super admin: build a quote from today's prices, save it, and print it as a branded PDF. */
export default async function QuotesPage() {
  await requireArea("platform");
  const supabase = await createClient(); // RLS: super admin only
  const [{ data: items }, { data: plans }, { data: settings }, { data: schools }, { data: quotes }] = await Promise.all([
    supabase.from("price_items").select("id, name, unit, unit_price").eq("active", true).gt("unit_price", 0).order("sort"),
    supabase.from("subscription_plans").select("id, name, min_students, max_students, monthly_price, active, sort").eq("active", true).order("sort"),
    supabase.from("platform_settings").select("annual_free_months").eq("id", true).maybeSingle(),
    supabase.from("schools").select("id, name").order("name"),
    supabase.from("quotes").select("id, number, school_name, plan_name, billing, first_payment, valid_until, created_at").order("created_at", { ascending: false }).limit(50),
  ]);
  // Student numbers only (never names): the super admin cannot read students through RLS.
  const admin = createAdminClient();
  const counts = await Promise.all((schools ?? []).map(async (s) => {
    const { count } = await admin.from("students").select("id", { count: "exact", head: true }).eq("school_id", s.id);
    return [s.id, count ?? 0] as const;
  }));
  const countOf = new Map(counts);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

  return (
    <>
      <PageHeader title="Quotes" description="Prices come from the Pricing page. Saved quotes keep the prices of the day they were made." />
      <section className="motion-rise surface rounded-xl p-5" aria-labelledby="new-quote">
        <h2 id="new-quote" className="mb-4 text-base font-semibold text-ink">New quote</h2>
        {(plans ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No active plans yet. Add a plan on the <Link href="/platform/pricing" className="text-brand hover:underline">Pricing</Link> page first.</p> : (
          <QuoteBuilder
            schools={(schools ?? []).map((s) => ({ id: s.id, name: s.name, students: countOf.get(s.id) ?? 0 }))}
            items={(items ?? []).map((i) => ({ ...i, unit_price: Number(i.unit_price) }))}
            plans={(plans ?? []).map((p) => ({ ...p, monthly_price: Number(p.monthly_price) }))}
            freeMonths={(settings?.annual_free_months as number | undefined) ?? 0}
          />
        )}
      </section>

      <section className="motion-rise mt-6 surface rounded-xl p-5" aria-labelledby="saved-quotes">
        <h2 id="saved-quotes" className="mb-3 text-base font-semibold text-ink">Saved quotes</h2>
        {(quotes ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No quotes yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2 pr-3 font-medium">Quote</th><th className="py-2 pr-3 font-medium">School</th><th className="py-2 pr-3 font-medium">Plan</th><th className="py-2 pr-3 text-right font-medium">First payment</th><th className="py-2 font-medium">Valid until</th></tr></thead>
              <tbody className="divide-y divide-border">
                {(quotes ?? []).map((q) => (
                  <tr key={q.id}>
                    <td className="py-2.5 pr-3"><Link href={`/platform/quotes/${q.id}`} className="font-medium text-brand tabular-nums hover:underline">{q.number}</Link></td>
                    <td className="py-2.5 pr-3 text-ink">{q.school_name}</td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{q.plan_name} · {q.billing === "annual" ? "yearly" : "monthly"}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{naira(Number(q.first_payment))}</td>
                    <td className={`py-2.5 tabular-nums ${q.valid_until < today ? "text-muted-foreground line-through" : ""}`}>{new Date(`${q.valid_until}T12:00:00Z`).toLocaleDateString("en-NG", { dateStyle: "medium" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
