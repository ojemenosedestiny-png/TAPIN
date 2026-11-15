import type { Metadata } from "next";
import { requireArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { naira } from "@/lib/pricing";
import { nextRenewal, renewalAmount, subscriptionStatus, type Billing, type SubStatus } from "@/lib/subscriptions";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusPill } from "@/components/dashboard/status-pill";
import { RenewButton, RepriceButton, SubscriptionDialog, SuspendButton, type SubPlan, type SubRow } from "./forms";

export const metadata: Metadata = { title: "Subscriptions" };

const ORDER: Record<SubStatus | "none", number> = { overdue: 0, due: 1, none: 2, suspended: 3, active: 4 };
const PILL: Record<SubStatus, { tone: "red" | "amber" | "green" | "slate"; label: string }> = {
  overdue: { tone: "red", label: "Overdue" }, due: { tone: "amber", label: "Due soon" }, active: { tone: "green", label: "Active" }, suspended: { tone: "slate", label: "Suspended" },
};
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-NG", { dateStyle: "medium" });

/** Super admin: what each school pays, when it renews, and who is overdue (first). */
export default async function SubscriptionsPage() {
  await requireArea("platform");
  const supabase = await createClient(); // RLS: super admin only
  const [{ data: schools }, { data: subs }, { data: plans }, { data: settings }] = await Promise.all([
    supabase.from("schools").select("id, name").order("name"),
    supabase.from("subscriptions").select("school_id, plan_id, agreed_monthly_price, billing, started_on, renews_on, suspended, notes"),
    supabase.from("subscription_plans").select("id, name, monthly_price, active").order("sort"),
    supabase.from("platform_settings").select("annual_free_months").eq("id", true).maybeSingle(),
  ]);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
  const freeMonths = (settings?.annual_free_months as number | undefined) ?? 0;
  const planList: SubPlan[] = (plans ?? []).map((p) => ({ ...p, monthly_price: Number(p.monthly_price) }));
  const planById = new Map(planList.map((p) => [p.id, p]));
  const subBySchool = new Map((subs ?? []).map((s) => [s.school_id, s]));

  const rows = (schools ?? []).map((school) => {
    const s = subBySchool.get(school.id);
    const sub: (SubRow & { suspended: boolean }) | null = s ? { ...s, agreed_monthly_price: Number(s.agreed_monthly_price), billing: s.billing as Billing } : null;
    const status = sub ? subscriptionStatus(sub.renews_on, sub.suspended, today) : null;
    return { school, sub, status, plan: sub ? planById.get(sub.plan_id) : undefined };
  }).sort((a, b) => ORDER[a.status ?? "none"] - ORDER[b.status ?? "none"] || (a.sub?.renews_on ?? "").localeCompare(b.sub?.renews_on ?? "") || a.school.name.localeCompare(b.school.name));

  const overdue = rows.filter((r) => r.status === "overdue").length;
  const due = rows.filter((r) => r.status === "due").length;
  const monthlyIncome = rows.reduce((a, r) => a + (r.sub && !r.sub.suspended ? r.sub.agreed_monthly_price : 0), 0);

  return (
    <>
      <PageHeader title="Subscriptions" description="Each school's plan, agreed price and renewal date. Schools are reminded 7 days before renewal." />

      <dl className="motion-rise mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="surface rounded-xl p-4"><dt className="text-xs text-muted-foreground">Overdue</dt><dd className={`mt-1 text-2xl font-semibold tabular-nums ${overdue ? "text-red-700" : "text-ink"}`}>{overdue}</dd></div>
        <div className="surface rounded-xl p-4"><dt className="text-xs text-muted-foreground">Renewing within 7 days</dt><dd className="mt-1 text-2xl font-semibold tabular-nums text-ink">{due}</dd></div>
        <div className="surface rounded-xl p-4"><dt className="text-xs text-muted-foreground">Monthly value (agreed prices)</dt><dd className="mt-1 text-2xl font-semibold tabular-nums text-ink">{naira(monthlyIncome)}</dd></div>
      </dl>

      <div className="motion-rise overflow-x-auto surface rounded-xl">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-muted/60 text-left text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">School</th>
              <th scope="col" className="px-4 py-3 font-medium">Plan</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Agreed price</th>
              <th scope="col" className="px-4 py-3 font-medium">Renews</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ school, sub, status, plan }) => {
              const differs = !!sub && !!plan && plan.monthly_price !== sub.agreed_monthly_price;
              return (
                <tr key={school.id} className={`border-t border-border ${status === "overdue" ? "bg-red-50/60" : ""}`}>
                  <td className="px-4 py-3 font-medium text-ink">{school.name}</td>
                  <td className="px-4 py-3">{sub ? <>{plan?.name ?? "—"} <span className="text-xs text-muted-foreground">· {sub.billing === "annual" ? "yearly" : "monthly"}</span></> : <span className="text-muted-foreground">No plan</span>}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {sub ? <>{naira(sub.agreed_monthly_price)}<span className="text-xs text-muted-foreground">/mo</span>
                      {differs && <span className="block text-xs text-muted-foreground">Plan now {naira(plan!.monthly_price)}</span>}
                      {sub.billing === "annual" && <span className="block text-xs text-muted-foreground">{naira(renewalAmount(sub.agreed_monthly_price, "annual", freeMonths))} a year</span>}</> : "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{sub ? day(sub.renews_on) : "—"}</td>
                  <td className="px-4 py-3">{status ? <StatusPill tone={PILL[status].tone}>{PILL[status].label}</StatusPill> : null}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      {sub && <RenewButton schoolId={school.id} until={day(nextRenewal(sub.renews_on, sub.billing))} />}
                      {differs && <RepriceButton schoolId={school.id} price={naira(plan!.monthly_price)} />}
                      {sub && <SuspendButton schoolId={school.id} suspended={sub.suspended} />}
                      <SubscriptionDialog schoolId={school.id} schoolName={school.name} plans={planList} sub={sub ?? undefined} today={today} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
