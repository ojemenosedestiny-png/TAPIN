import { naira, type WebPricing } from "@/lib/pricing";
import { BookDemo } from "./book-demo";

/** Offices and companies: staff-only plans by number of staff. Always by quote (setup differs per building). */
export function OfficePlans({ pricing }: { pricing: WebPricing }) {
  const plans = pricing.orgPlans;
  return (
    <section id="offices" className="wrap" style={{ paddingTop: 24, paddingBottom: 112, display: "flex", flexDirection: "column", gap: 24 }} aria-labelledby="offices-h">
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 720 }}>
        <p className="eyebrow">Offices and companies</p>
        <h2 id="offices-h" className="jk" style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" }}>Staff attendance for any workplace</h2>
        <p style={{ margin: 0, fontSize: 16, color: "var(--slate)" }}>
          Card + PIN at the entrance, a photo with every check-in, and alerts for late arrivals and early leavers. Priced by number of staff.
        </p>
      </div>
      {plans.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
          {plans.map((p) => (
            <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 10, padding: 24, borderRadius: 20, background: "var(--card)", border: "1px solid var(--line)" }}>
              <p className="jk" style={{ margin: 0, fontSize: 19, fontWeight: 800 }}>{p.name}</p>
              <p style={{ margin: 0, fontSize: 14, color: "var(--slate)" }}>For {p.range}</p>
              <p className="jk" style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>
                {p.monthlyPrice === null ? "Price on request" : <>{naira(p.monthlyPrice)}<span style={{ fontFamily: "var(--font-inter)", fontSize: 14, fontWeight: 500, color: "var(--slate-2)" }}> / month</span></>}
              </p>
              {p.features.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4, fontSize: 14, color: "var(--slate-3)" }}>
                  {p.features.map((f) => <li key={f}>{f}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 15, color: "var(--slate)" }}>Office plans are priced for your building and number of staff.</p>
      )}
      <div><BookDemo label="Get a quote for your office" className="btn btn-teal" office /></div>
    </section>
  );
}
