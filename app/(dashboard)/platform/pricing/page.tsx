import type { Metadata } from "next";
import { requireArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { naira } from "@/lib/pricing";
import { studentRange } from "@/lib/subscriptions";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusPill } from "@/components/dashboard/status-pill";
import { AnnualForm, ItemDialog, MoveButtons, PlanDialog, type ItemRow, type PlanRow } from "./forms";

export const metadata: Metadata = { title: "Pricing" };

const FIELD: Record<string, string> = {
  created: "Created", unit_price: "Price", monthly_price: "Monthly price", active: "Active", name: "Name", students: "Student range",
  annual_free_months: "Free months (yearly)", agreed_monthly_price: "Agreed monthly price",
};
const ENTITY: Record<string, string> = { item: "Setup item", plan: "Plan", settings: "Setting", subscription: "School" };

function showValue(field: string, v: string | null): string {
  if (v === null) return "—";
  if (["unit_price", "monthly_price", "agreed_monthly_price", "created"].includes(field) && /^\d+(\.\d+)?$/.test(v)) return naira(Number(v));
  if (v === "true") return "Yes";
  if (v === "false") return "No";
  return v;
}

/** Super admin: setup items, monthly plans, the yearly discount, and every price change. No price lives in the code. */
export default async function PricingPage() {
  await requireArea("platform");
  const supabase = await createClient(); // RLS: super admin only
  const [{ data: items }, { data: plans }, { data: settings }, { data: history }] = await Promise.all([
    supabase.from("price_items").select("id, name, description, unit, unit_price, active").order("sort").order("created_at"),
    supabase.from("subscription_plans").select("id, name, min_students, max_students, monthly_price, features, tier, active").order("sort").order("created_at"),
    supabase.from("platform_settings").select("annual_free_months").eq("id", true).maybeSingle(),
    supabase.from("price_history").select("id, entity, name, field, old_value, new_value, changed_at, users(name)").order("changed_at", { ascending: false }).limit(40),
  ]);
  const itemList = (items ?? []) as ItemRow[];
  const planList = (plans ?? []) as PlanRow[];

  return (
    <>
      <PageHeader title="Pricing" description="One-time setup items and monthly plans. New quotes use these prices; schools keep the price they agreed until you move them." />

      <section className="motion-rise surface rounded-xl p-5" aria-labelledby="items-h">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="items-h" className="text-base font-semibold text-ink">One-time setup items</h2>
          <ItemDialog />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2 pr-3 font-medium">Item</th><th className="py-2 pr-3 font-medium">Price</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2" /></tr></thead>
            <tbody className="divide-y divide-border">
              {itemList.map((it, i) => (
                <tr key={it.id}>
                  <td className="py-2.5 pr-3"><span className="font-medium text-ink">{it.name}</span>{it.description && <span className="block text-xs text-muted-foreground">{it.description}</span>}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{naira(Number(it.unit_price))} <span className="text-xs text-muted-foreground">{it.unit}</span></td>
                  <td className="py-2.5 pr-3"><StatusPill tone={it.active ? "green" : "slate"}>{it.active ? "Active" : "Off"}</StatusPill></td>
                  <td className="py-2.5"><div className="flex justify-end"><MoveButtons id={it.id} table="price_items" first={i === 0} last={i === itemList.length - 1} name={it.name} /><ItemDialog item={{ ...it, unit_price: Number(it.unit_price) }} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {itemList.some((i) => !i.active || Number(i.unit_price) === 0) && <p className="mt-3 text-xs text-muted-foreground">Items that are off, or priced at ₦0, don&apos;t appear on new quotes until you set a price and switch them on.</p>}
      </section>

      <section className="motion-rise mt-6 surface rounded-xl p-5" aria-labelledby="plans-h">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="plans-h" className="text-base font-semibold text-ink">Monthly plans</h2>
          <PlanDialog />
        </div>
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {planList.map((p, i) => (
            <li key={p.id} className="rounded-xl border border-border p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-ink">{p.name} {p.tier === "premium" && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Premium</span>}</p>
                  <p className="text-xs text-muted-foreground">{studentRange(p.min_students, p.max_students)}</p>
                </div>
                <StatusPill tone={p.active ? "green" : "slate"}>{p.active ? "Active" : "Retired"}</StatusPill>
              </div>
              <p className="mt-3 text-2xl font-semibold tabular-nums text-ink">{naira(Number(p.monthly_price))}<span className="text-sm font-normal text-muted-foreground"> / month</span></p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">{p.features.map((f) => <li key={f}>✓ {f}</li>)}</ul>
              <div className="mt-3 flex justify-end"><MoveButtons id={p.id} table="subscription_plans" first={i === 0} last={i === planList.length - 1} name={p.name} /><PlanDialog plan={{ ...p, monthly_price: Number(p.monthly_price) }} /></div>
            </li>
          ))}
        </ul>
      </section>

      <section className="motion-rise mt-6 surface rounded-xl p-5" aria-labelledby="annual-h">
        <h2 id="annual-h" className="mb-3 text-base font-semibold text-ink">Paying yearly</h2>
        <AnnualForm months={(settings?.annual_free_months as number | undefined) ?? 0} />
      </section>

      <section className="motion-rise mt-6 surface rounded-xl p-5" aria-labelledby="history-h">
        <h2 id="history-h" className="mb-3 text-base font-semibold text-ink">Price history</h2>
        {(history ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No changes yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2 pr-3 font-medium">When</th><th className="py-2 pr-3 font-medium">What</th><th className="py-2 pr-3 font-medium">Change</th><th className="py-2 font-medium">By</th></tr></thead>
              <tbody className="divide-y divide-border">
                {(history ?? []).map((h) => (
                  <tr key={h.id}>
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{new Date(h.changed_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" })}</td>
                    <td className="py-2 pr-3"><span className="font-medium text-ink">{h.name}</span><span className="block text-xs text-muted-foreground">{ENTITY[h.entity] ?? h.entity} · {FIELD[h.field] ?? h.field}</span></td>
                    <td className="py-2 pr-3 tabular-nums">{h.field === "created" ? showValue(h.field, h.new_value) : `${showValue(h.field, h.old_value)} → ${showValue(h.field, h.new_value)}`}</td>
                    <td className="py-2 text-muted-foreground">{(h.users as unknown as { name: string } | null)?.name ?? "—"}</td>
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
