import type { Metadata } from "next";
import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { invoiceLines, monthLabel, naira } from "@/lib/billing";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusPill, type PillTone } from "@/components/dashboard/status-pill";
import { KpiStrip } from "@/components/dashboard/today-blocks";
import { GenerateInvoices, InvoiceStatusButton, PlatformSettingsForm, PricingDialog } from "./forms";

export const metadata: Metadata = { title: "Billing" };

const STATUS: Record<string, [PillTone, string]> = { issued: ["amber", "Unpaid"], paid: ["green", "Paid"], void: ["slate", "Void"] };

export default async function BillingPage() {
  await requireArea("platform");
  // Super admin only (checked above). Service role for counts across schools — never student names.
  const db = createAdminClient();
  const now = new Date();
  const thisMonth = `${now.toISOString().slice(0, 7)}-01`;
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);

  const [{ data: schools }, { data: usage }, { data: invoices }, { data: settings }] = await Promise.all([
    db.from("schools").select("id, name, price_per_student, setup_fee, price_per_sms, billing_start, billing_email").order("name"),
    db.rpc("school_usage", { p_month: thisMonth }),
    db.from("invoices").select("id, school_id, number, period, total, status, issued_at").order("issued_at", { ascending: false }).limit(60),
    db.from("platform_settings").select("*").eq("id", true).single(),
  ]);
  const usageBy = new Map(((usage ?? []) as { school_id: string; active_students: number; sms_sent: number }[]).map((u) => [u.school_id, u]));
  const invoiced = new Set((invoices ?? []).map((i) => i.school_id));
  const name = new Map((schools ?? []).map((s) => [s.id, s.name]));

  const rows = (schools ?? []).map((s) => {
    const u = usageBy.get(s.id) ?? { active_students: 0, sms_sent: 0 };
    const pricing = { price_per_student: Number(s.price_per_student), setup_fee: Number(s.setup_fee), price_per_sms: Number(s.price_per_sms) };
    const estimate = invoiceLines(pricing, u, { period: thisMonth, firstInvoice: !invoiced.has(s.id) }).total;
    return { ...s, ...pricing, usage: u, estimate };
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

      <section className="motion-rise mt-6 max-w-3xl surface rounded-xl p-6" aria-labelledby="business">
        <h2 id="business" className="mb-1 text-base font-semibold text-ink">Your business details</h2>
        <p className="mb-4 text-sm text-muted-foreground">Printed on every invoice, with where to pay.</p>
        {settings && <PlatformSettingsForm settings={settings} />}
      </section>
    </>
  );
}
