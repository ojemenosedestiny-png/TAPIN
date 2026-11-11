import type { Metadata } from "next";
import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { invoiceLines, monthLabel, naira } from "@/lib/billing";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusPill, type PillTone } from "@/components/dashboard/status-pill";
import { KpiStrip } from "@/components/dashboard/today-blocks";
import { GenerateInvoices, InvoiceStatusButton, OrderStatusButtons, PlatformSettingsForm, PricingDialog, WebsitePricesForm } from "./forms";
import { formatNgPhone } from "@/lib/phone";

export const metadata: Metadata = { title: "Billing" };

const STATUS: Record<string, [PillTone, string]> = { issued: ["amber", "Unpaid"], paid: ["green", "Paid"], void: ["slate", "Void"] };

export default async function BillingPage() {
  await requireArea("platform");
  // Super admin only (checked above). Service role for counts across schools — never student names.
  const db = createAdminClient();
  const now = new Date();
  const thisMonth = `${now.toISOString().slice(0, 7)}-01`;
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);

  const [{ data: schools }, { data: usage }, { data: invoices }, { data: settings }, { data: orders }, { data: parentPays }] = await Promise.all([
    db.from("schools").select("id, name, price_per_student, setup_fee, price_per_sms, billing_start, billing_email, public_code, parent_fee").order("name"),
    db.rpc("school_usage", { p_month: thisMonth }),
    db.from("invoices").select("id, school_id, number, period, total, status, issued_at").order("issued_at", { ascending: false }).limit(60),
    db.from("platform_settings").select("*").eq("id", true).single(),
    db.from("orders").select("id, reference, plan, billing, students, school_name, contact_name, phone, email, state, method, amount, status, created_at").order("created_at", { ascending: false }).limit(50),
    db.from("parent_payments").select("id, reference, school_id, amount, status, method, created_at, paid_at").order("created_at", { ascending: false }).limit(50),
  ]);
  const usageBy = new Map(((usage ?? []) as { school_id: string; active_students: number; sms_sent: number }[]).map((u) => [u.school_id, u]));
  const invoiced = new Set((invoices ?? []).map((i) => i.school_id));
  const name = new Map((schools ?? []).map((s) => [s.id, s.name]));

  const rows = (schools ?? []).map((s) => {
    const u = usageBy.get(s.id) ?? { active_students: 0, sms_sent: 0 };
    const pricing = { price_per_student: Number(s.price_per_student), setup_fee: Number(s.setup_fee), price_per_sms: Number(s.price_per_sms) };
    const estimate = invoiceLines(pricing, u, { period: thisMonth, firstInvoice: !invoiced.has(s.id) }).total;
    return { ...s, ...pricing, parent_fee: s.parent_fee === null ? null : Number(s.parent_fee), usage: u, estimate };
  });
  const unpaid = (invoices ?? []).filter((i) => i.status === "issued").reduce((a, i) => a + Number(i.total), 0);
  const students = rows.reduce((a, r) => a + r.usage.active_students, 0);
  const estimateTotal = rows.filter((r) => r.billing_start).reduce((a, r) => a + r.estimate, 0);

  return (
    <>
      <PageHeader title="Billing" description="Pricing, usage and invoices for every school." />

      <KpiStrip items={[
        { label: `Estimated ${monthLabel(thisMonth)}`, value: Math.round(estimateTotal), lead: true, caption: "Naira, schools with billing started" },
        { label: "Active students", value: students, caption: `Across ${rows.length} school${rows.length === 1 ? "" : "s"}` },
        { label: "Unpaid invoices", value: Math.round(unpaid), tone: "warn", caption: "Naira outstanding" },
      ]} />

      <section className="motion-rise mt-6 overflow-x-auto surface rounded-xl" aria-labelledby="schools">
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 pb-2 pt-4">
          <h2 id="schools" className="text-base font-semibold text-ink">Schools this month</h2>
          <GenerateInvoices defaultMonth={lastMonth.slice(0, 7)} schools={rows.map((r) => ({ id: r.id, name: r.name }))} />
        </div>
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-5 py-2 font-normal">School</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Active students</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">SMS sent</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Per student</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Estimate</th>
              <th scope="col" className="px-3 py-2 font-normal">Billing from</th>
              <th scope="col" className="px-5 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-5 py-2.5 font-medium text-ink">{r.name}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.usage.active_students.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{r.usage.sms_sent.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.price_per_student ? naira(r.price_per_student) : <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-medium text-ink">{r.billing_start ? naira(r.estimate) : <span className="font-normal text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{r.billing_start ?? "Not set"}</td>
                <td className="px-5 py-2.5 text-right"><PricingDialog school={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-5 pb-5 text-sm text-muted-foreground">No schools yet.</p>}
      </section>

      <section className="motion-rise mt-6 overflow-x-auto surface rounded-xl" aria-labelledby="invoices">
        <h2 id="invoices" className="px-5 pb-2 pt-4 text-base font-semibold text-ink">Invoices</h2>
        {(invoices ?? []).length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">No invoices yet. Set a school&apos;s pricing and billing start, then issue invoices for a finished month.</p>
        ) : (
          <table className="w-full min-w-[700px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-5 py-2 font-normal">Invoice</th>
                <th scope="col" className="px-3 py-2 font-normal">School</th>
                <th scope="col" className="px-3 py-2 font-normal">Month</th>
                <th scope="col" className="px-3 py-2 text-right font-normal">Total</th>
                <th scope="col" className="px-3 py-2 font-normal">Status</th>
                <th scope="col" className="px-5 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {(invoices ?? []).map((i) => {
                const [tone, label] = STATUS[i.status] ?? ["slate", i.status];
                return (
                  <tr key={i.id} className="border-t border-border">
                    <td className="px-5 py-2.5"><Link href={`/invoices/${i.id}`} className="font-medium tabular-nums text-ink hover:text-brand">{i.number}</Link></td>
                    <td className="px-3 py-2.5 text-muted-foreground">{name.get(i.school_id) ?? "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{monthLabel(i.period)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">{naira(Number(i.total))}</td>
                    <td className="px-3 py-2.5"><StatusPill tone={tone}>{label}</StatusPill></td>
                    <td className="px-5 py-2.5">
                      <div className="flex justify-end gap-1">
                        {i.status === "issued" && <InvoiceStatusButton id={i.id} status="paid" label="Mark paid" />}
                        {i.status === "issued" && <InvoiceStatusButton id={i.id} status="void" label="Void" variant="ghost" />}
                        {i.status !== "issued" && <InvoiceStatusButton id={i.id} status="issued" label="Undo" variant="ghost" />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="motion-rise mt-6 overflow-x-auto surface rounded-xl" aria-labelledby="orders">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-2 pt-4">
          <h2 id="orders" className="text-base font-semibold text-ink">Website orders</h2>
          <p className="text-xs text-muted-foreground">Schools that chose a plan on the pricing page</p>
        </div>
        {(orders ?? []).length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">No orders yet.</p>
        ) : (
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-5 py-2 font-normal">School</th>
                <th scope="col" className="px-3 py-2 font-normal">Contact</th>
                <th scope="col" className="px-3 py-2 font-normal">Plan</th>
                <th scope="col" className="px-3 py-2 text-right font-normal">Amount</th>
                <th scope="col" className="px-3 py-2 font-normal">Status</th>
                <th scope="col" className="px-5 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {(orders ?? []).map((o) => (
                <tr key={o.id} className="border-t border-border align-top">
                  <td className="px-5 py-2.5"><span className="font-medium text-ink">{o.school_name}</span><span className="block text-xs text-muted-foreground">{o.state} · {o.students.toLocaleString()} students · {o.reference}</span></td>
                  <td className="px-3 py-2.5">{o.contact_name}<span className="block text-xs"><a href={`tel:${o.phone}`} className="text-brand hover:underline">{formatNgPhone(o.phone)}</a> · <a href={`mailto:${o.email}`} className="text-brand hover:underline">{o.email}</a></span></td>
                  <td className="px-3 py-2.5 capitalize">{o.plan} <span className="text-xs text-muted-foreground">per {o.billing} · {o.method}</span></td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{o.amount === null ? "Quote" : naira(Number(o.amount))}</td>
                  <td className="px-3 py-2.5"><StatusPill tone={o.status === "paid" ? "green" : o.status === "cancelled" || o.status === "failed" ? "slate" : "amber"}>{o.status === "quote" ? "Wants a quote" : o.status[0]!.toUpperCase() + o.status.slice(1)}</StatusPill></td>
                  <td className="px-5 py-2.5 text-right">{(o.status === "pending" || o.status === "quote") && <OrderStatusButtons id={o.id} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="motion-rise mt-6 overflow-x-auto surface rounded-xl" aria-labelledby="parent-pays">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-2 pt-4">
          <h2 id="parent-pays" className="text-base font-semibold text-ink">Parent payments</h2>
          <p className="text-xs text-muted-foreground">TapIn fees paid by parents online</p>
        </div>
        {(parentPays ?? []).length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">None yet. Give a school a code and a parent fee (Pricing) to switch this on.</p>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th scope="col" className="px-5 py-2 font-normal">School</th><th scope="col" className="px-3 py-2 font-normal">Reference</th><th scope="col" className="px-3 py-2 text-right font-normal">Amount</th><th scope="col" className="px-5 py-2 font-normal">Status</th></tr>
            </thead>
            <tbody>
              {(parentPays ?? []).map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-5 py-2.5">{name.get(p.school_id) ?? "—"}</td>
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{p.reference}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{naira(Number(p.amount))}</td>
                  <td className="px-5 py-2.5"><StatusPill tone={p.status === "paid" ? "green" : p.status === "failed" ? "slate" : "amber"}>{p.status[0]!.toUpperCase() + p.status.slice(1)}</StatusPill></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="motion-rise mt-6 max-w-3xl surface rounded-xl p-6" aria-labelledby="web-prices">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="web-prices" className="text-base font-semibold text-ink">Website prices</h2>
          <a href="/pricing" target="_blank" rel="noreferrer" className="text-sm font-medium text-brand hover:underline">Open the pricing page</a>
        </div>
        {settings && (
          <WebsitePricesForm prices={{
            starter_price: settings.starter_price === null ? null : Number(settings.starter_price),
            standard_price: settings.standard_price === null ? null : Number(settings.standard_price),
            web_setup_fee: settings.web_setup_fee === null ? null : Number(settings.web_setup_fee),
            yearly_discount_pct: settings.yearly_discount_pct === null ? null : Number(settings.yearly_discount_pct),
            live_within_days: settings.live_within_days,
            whatsapp: settings.whatsapp,
          }} />
        )}
      </section>

      <section className="motion-rise mt-6 max-w-3xl surface rounded-xl p-6" aria-labelledby="business">
        <h2 id="business" className="mb-1 text-base font-semibold text-ink">Your business details</h2>
        <p className="mb-4 text-sm text-muted-foreground">Printed on every invoice, with where to pay.</p>
        {settings && <PlatformSettingsForm settings={settings} />}
      </section>
    </>
  );
}
