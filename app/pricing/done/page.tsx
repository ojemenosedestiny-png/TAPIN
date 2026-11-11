import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { settlePayment } from "@/lib/payments";
import { naira } from "@/lib/pricing";
import { loadPricing } from "@/lib/pricing-data";
import "../../site.css";

export const metadata: Metadata = { title: { absolute: "TapIn · Payment" }, robots: { index: false, follow: false } };

type Search = Promise<{ ref?: string; tx_ref?: string }>;

async function Result({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const s = await settlePayment(sp.ref ?? sp.tx_ref ?? "");
  const paid = s?.status === "paid";
  const title = !s ? "We couldn't find that payment" : paid ? "Payment received. Thank you!" : s.status === "pending" ? "Payment not confirmed yet" : "Payment didn't go through";
  const body = !s
    ? "If money left your account, contact us with the reference from your bank or Flutterwave receipt."
    : paid
      ? s.kind === "school"
        ? `${naira(s.amount ?? 0)} for ${s.schoolName}. A receipt is on its way to ${s.email}, and we'll call you to arrange setup.`
        : `${naira(s.amount)} paid for your child's TapIn fee. The school can see it straight away.`
      : s.status === "pending"
        ? "Bank transfers and USSD can take a few minutes. Refresh this page shortly; you don't need to pay again."
        : "Nothing was charged. You can try again from the pricing page.";
  return (
    <div className="panel" role="status" style={{ maxWidth: 680, margin: "0 auto", textAlign: "center", alignItems: "center", padding: 48 }}>
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke={paid ? "#16a34a" : "#d97706"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ animation: "site-pop 500ms cubic-bezier(0.3, 1.5, 0.5, 1) both" }}>
        <circle cx="12" cy="12" r="10" />{paid ? <path d="M7 12.5l3.2 3.2L17 9" /> : <path d="M12 7v6M12 17h.01" />}
      </svg>
      <h1 className="jk" style={{ margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em" }}>{title}</h1>
      <p style={{ margin: 0, fontSize: 17, color: "var(--slate)" }}>{body}</p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center", marginTop: 8 }}>
        {!paid && <Link href="/pricing" className="btn btn-teal">Back to pricing</Link>}
        <Link href="/" className="btn btn-line">TapIn home</Link>
      </div>
    </div>
  );
}

export default async function DonePage({ searchParams }: { searchParams: Search }) {
  const pricing = await loadPricing();
  return (
    <main id="main" className="site">
      <section className="site-dark"><SiteHeader /></section>
      <section className="wrap" style={{ paddingTop: 80, paddingBottom: 120 }}>
        <Suspense fallback={<p style={{ textAlign: "center" }} aria-busy="true">Checking your payment…</p>}>
          <Result searchParams={searchParams} />
        </Suspense>
      </section>
      <SiteFooter contact={pricing.contact} />
    </main>
  );
}
