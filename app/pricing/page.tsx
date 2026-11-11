import type { Metadata } from "next";
import { Suspense } from "react";
import { Reveal } from "@/components/home/reveal";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { PricingClient } from "@/components/site/pricing-client";
import { loadPricing } from "@/lib/pricing-data";
import { flutterwaveKey } from "@/lib/flutterwave";
import "../site.css";

export const metadata: Metadata = {
  title: { absolute: "TapIn · Pricing and payment" },
  description: "Schools subscribe per student, per term. Parents can pay their child's TapIn fee when their school asks them to.",
};

type Search = Promise<{ plan?: string; for?: string }>;

async function Body({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const pricing = await loadPricing();
  const plan = pricing.plans.some((p) => p.id === sp.plan) ? (sp.plan as "starter" | "standard" | "campus") : "standard";
  return <PricingClient pricing={pricing} initialTab={sp.for === "parents" ? "parent" : "school"} initialPlan={plan} online={!!flutterwaveKey()} />;
}

export default async function PricingPage({ searchParams }: { searchParams: Search }) {
  const pricing = await loadPricing();
  return (
    <main id="main" className="site theme-light">
      <Reveal />
      <section className="site-dark plain">
        <SiteHeader active="pricing" />
        <div className="wrap load-in" style={{ paddingTop: 48, paddingBottom: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 18, textAlign: "center" }}>
          <h1 className="jk" style={{ margin: 0, maxWidth: 760, fontSize: "clamp(36px, 4.6vw, 58px)", lineHeight: 1.06, fontWeight: 800, letterSpacing: "-0.035em" }}>Pricing and payments</h1>
          <p style={{ margin: 0, maxWidth: 560, fontSize: 18, color: "var(--on-deep)" }}>Schools subscribe per student, per term. Parents can pay their child&apos;s TapIn fee here when their school asks them to.</p>
        </div>
      </section>
      <Suspense fallback={<div style={{ minHeight: 800 }} aria-busy="true" />}>
        <Body searchParams={searchParams} />
      </Suspense>
      <SiteFooter contact={pricing.contact} />
    </main>
  );
}
