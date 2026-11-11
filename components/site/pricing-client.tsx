"use client";

import { useActionState, useState } from "react";
import { Lock } from "lucide-react";
import { findChild, payChildFee, placeOrder, type FoundChild, type PayState } from "@/app/pricing/actions";
import { METHODS, naira, pricePerStudent, quoteFor, type Billing, type PayMethod, type PlanId, type WebPricing } from "@/lib/pricing";
import { BookDemo } from "./book-demo";

const STATES = ["Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT Abuja", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara"];

const Check = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0F766E" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: "none" }}><path d="M5 12l5 5L20 7" /></svg>
);

function Field({ id, label, error, ...props }: { id: string; label: string; error?: string } & React.ComponentProps<"input">) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-e` : undefined} {...props} />
      {error && <p id={`${id}-e`} className="err">{error}</p>}
    </div>
  );
}

function Methods({ value, onChange }: { value: PayMethod; onChange: (m: PayMethod) => void }) {
  return (
    <div role="radiogroup" aria-label="Payment method" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
      {METHODS.map((m) => (
        <button key={m.id} type="button" role="radio" aria-checked={value === m.id} className="choice" onClick={() => onChange(m.id)}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{m.name}</span>
          <span style={{ fontSize: 13, color: "var(--slate-2)" }}>{m.note}</span>
        </button>
      ))}
    </div>
  );
}

export function PricingClient({ pricing, initialTab, initialPlan, online }: { pricing: WebPricing; initialTab: "school" | "parent"; initialPlan: PlanId; online: boolean }) {
  const [tab, setTab] = useState(initialTab);
  return (
    <>
      <section className="site-dark plain">
        <div className="wrap" style={{ paddingTop: 30, paddingBottom: 72, display: "flex", justifyContent: "center" }}>
          <div role="tablist" aria-label="Who is paying" style={{ display: "flex", gap: 6, padding: 6, background: "var(--deep-2)", borderRadius: 999 }}>
            {(["school", "parent"] as const).map((t) => (
              <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} onClick={() => setTab(t)}
                style={{ height: 48, padding: "0 24px", border: "none", borderRadius: 999, fontSize: 15, fontWeight: 700, cursor: "pointer", transition: "background-color 200ms ease, color 200ms ease",
                  background: tab === t ? "#fff" : "transparent", color: tab === t ? "#0f172a" : "var(--on-deep-2)" }}>
                {t === "school" ? "For schools" : "For parents"}
              </button>
            ))}
          </div>
        </div>
      </section>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} key={tab} style={{ animation: "site-rise 500ms cubic-bezier(0.16, 1, 0.3, 1) both" }}>
        {tab === "school" ? <SchoolTab pricing={pricing} initialPlan={initialPlan} online={online} /> : <ParentTab online={online} />}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------- Schools

function SchoolTab({ pricing: PRICING, initialPlan, online }: { pricing: WebPricing; initialPlan: PlanId; online: boolean }) {
  const [plan, setPlan] = useState<PlanId>(initialPlan);
  const [billing, setBilling] = useState<Billing>("term");
  const [method, setMethod] = useState<PayMethod>("card");
  const [students, setStudents] = useState("");
  const [state, action, pending] = useActionState<PayState, FormData>(placeOrder, {});
  const e = state.errors ?? {};
  const yearly = PRICING.yearlyDiscountPct !== null;
  const chosen = PRICING.plans.find((p) => p.id === plan)!;
  const per = pricePerStudent(chosen, billing, PRICING.yearlyDiscountPct);
  const count = Number.parseInt(students.replace(/[^\d]/g, ""), 10);
  const quote = Number.isFinite(count) ? quoteFor(plan, billing, count, PRICING) : null;
  const unit = billing === "year" ? "/ student / year" : "/ student / term";
  const payLabel = per === null ? "Request a quote" : online ? "Pay securely" : "Get an invoice";

  if (state.ok) {
    return (
      <section className="wrap" style={{ paddingTop: 72, paddingBottom: 112 }}>
        <div className="panel" role="status" style={{ maxWidth: 680, margin: "0 auto", textAlign: "center", alignItems: "center", padding: 48 }}>
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ animation: "site-pop 500ms cubic-bezier(0.3, 1.5, 0.5, 1) both" }}><circle cx="12" cy="12" r="10" /><path d="M7 12.5l3.2 3.2L17 9" /></svg>
          <h2 className="jk" style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>Order received</h2>
          <p style={{ margin: 0, fontSize: 17, color: "var(--slate)" }}>{state.ok}</p>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="wrap" style={{ paddingTop: 56, display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <h2 className="jk" style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" }}>1. Choose a plan</h2>
          {yearly && (
            <div role="group" aria-label="Billing period" style={{ display: "flex", gap: 4, padding: 4, background: "var(--line)", borderRadius: 999 }}>
              {(["term", "year"] as const).map((b) => (
                <button key={b} type="button" aria-pressed={billing === b} onClick={() => setBilling(b)}
                  style={{ height: 44, padding: "0 18px", border: "none", borderRadius: 999, fontSize: 14, fontWeight: 700, cursor: "pointer", transition: "background-color 200ms ease",
                    background: billing === b ? "var(--card)" : "transparent", color: billing === b ? "var(--ink)" : "var(--slate)", boxShadow: billing === b ? "0 1px 3px rgba(15,23,42,0.15)" : "none" }}>
                  {b === "term" ? "Per term" : `Per year · save ${PRICING.yearlyDiscountPct}%`}
                </button>
              ))}
            </div>
          )}
        </div>
        <div role="radiogroup" aria-label="Plan" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))", gap: 20 }}>
          {PRICING.plans.map((p, i) => {
            const on = plan === p.id;
            const price = pricePerStudent(p, billing, PRICING.yearlyDiscountPct);
            return (
              <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => setPlan(p.id)}
                style={{ all: "unset", boxSizing: "border-box", cursor: "pointer", display: "flex", flexDirection: "column", gap: 16, padding: 28, borderRadius: 24, background: "var(--card)",
                  border: `2px solid ${on ? "var(--teal)" : "var(--line)"}`, boxShadow: on ? "0 20px 40px rgba(15,118,110,0.14)" : "none",
                  transition: "border-color 200ms ease, box-shadow 240ms ease, transform 240ms ease", transform: on ? "translateY(-4px)" : "none", ["--i" as string]: i } as React.CSSProperties}>
                <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, width: "100%" }}>
                  <span className="jk" style={{ fontSize: 20, fontWeight: 800 }}>{p.name}{p.popular && <span className="popular" style={{ marginLeft: 10, verticalAlign: "middle" }}>Most popular</span>}</span>
                  <span aria-hidden style={{ width: 22, height: 22, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", flex: "none", border: `2px solid ${on ? "var(--teal)" : "#94A3B8"}` }}>
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: on ? "var(--teal)" : "transparent", transition: "transform 200ms cubic-bezier(0.3, 1.5, 0.5, 1)", transform: on ? "scale(1)" : "scale(0)" }} />
                  </span>
                </span>
                <span style={{ fontSize: 15, color: "var(--slate)" }}>{p.blurb}</span>
                <span className="jk" style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em" }}>
                  {p.custom ? "Custom" : price === null ? "Price on request" : <>{naira(price)}<span className="unit" style={{ fontFamily: "var(--font-inter)", fontSize: 14, fontWeight: 500, color: "var(--slate-2)" }}> {unit}</span></>}
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 15, color: "var(--slate-3)" }}>
                  {p.features.map((f) => <span key={f} style={{ display: "flex", alignItems: "center", gap: 10 }}><Check />{f}</span>)}
                </span>
              </button>
            );
          })}
        </div>
        <p style={{ margin: 0, fontSize: 14, color: "var(--slate-2)" }}>Every plan includes a one-time setup: kiosk installation, printed smart ID cards and student registration.</p>
      </section>

      <section className="wrap" style={{ paddingTop: 56, paddingBottom: 112, display: "flex", flexWrap: "wrap", gap: 32, alignItems: "flex-start" }}>
        <form id="school-order" action={action} noValidate
          style={{ flex: "1.5 1 520px", minWidth: 0, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 28, padding: "clamp(24px, 4vw, 40px)", display: "flex", flexDirection: "column", gap: 28 }}>
          <input type="hidden" name="plan" value={plan} />
          <input type="hidden" name="billing" value={billing} />
          <input type="hidden" name="method" value={method} />
          <h2 className="jk" style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" }}>2. School details</h2>
          {e._form && <p className="err" role="alert">{e._form}</p>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 18 }}>
            <Field id="s-name" name="school_name" label="School name" placeholder="e.g. Greenfield Academy" autoComplete="organization" error={e.school_name} />
            <Field id="s-students" name="students" label="Number of students" inputMode="numeric" placeholder="e.g. 450" value={students} onChange={(ev) => setStudents(ev.target.value)} error={e.students} />
            <Field id="s-contact" name="contact_name" label="Your name" placeholder="Principal or proprietor" autoComplete="name" error={e.contact_name} />
            <Field id="s-phone" name="phone" label="Phone number" type="tel" inputMode="tel" placeholder="080..." autoComplete="tel" error={e.phone} />
            <Field id="s-email" name="email" label="Email" type="email" placeholder="you@school.edu.ng" autoComplete="email" error={e.email} />
            <div className="field">
              <label htmlFor="s-state">State</label>
              <select id="s-state" name="state" defaultValue="FCT Abuja">{STATES.map((s) => <option key={s}>{s}</option>)}</select>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 className="jk" style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" }}>3. Payment method</h2>
            <Methods value={method} onChange={setMethod} />
          </div>
        </form>

        <aside style={{ flex: "1 1 340px", minWidth: 0, background: "var(--deep)", color: "#fff", borderRadius: 28, padding: 32, display: "flex", flexDirection: "column", gap: 20, position: "sticky", top: 24 }} aria-labelledby="summary-h">
          <h2 id="summary-h" className="jk" style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Order summary</h2>
          <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 14, fontSize: 15 }}>
            {[
              ["Plan", chosen.name],
              ["Billing", billing === "year" ? "Yearly" : "Termly"],
              ["Per student", chosen.custom ? "Custom quote" : per === null ? "On request" : naira(per)],
              ["Students", Number.isFinite(count) && count > 0 ? count.toLocaleString() : "—"],
              ...(PRICING.setupFee !== null ? [["Setup (one-time)", naira(PRICING.setupFee)]] : []),
              ["Pay with", METHODS.find((m) => m.id === method)!.name],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><dt style={{ color: "var(--on-deep)" }}>{k}</dt><dd style={{ margin: 0, fontWeight: 700 }}>{v}</dd></div>
            ))}
          </dl>
          <div style={{ borderTop: "1px solid #2A5652", paddingTop: 18, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <span style={{ fontSize: 15, color: "var(--on-deep)" }}>Due today</span>
            <span key={quote?.total ?? "x"} className="jk" style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em", animation: "site-pop 300ms ease both" }}>
              {quote ? naira(quote.total) : per === null ? "Quote" : "—"}
            </span>
          </div>
          <button type="submit" form="school-order" className="btn btn-gold jk" disabled={pending} style={{ height: 56, fontSize: 17, fontWeight: 800 }}>
            {pending ? "One moment…" : payLabel}
          </button>
          <p style={{ margin: 0, display: "flex", gap: 10, fontSize: 13, color: "var(--on-deep)" }}>
            <Lock className="size-4 shrink-0" style={{ color: "#5EEAD4", marginTop: 2 }} aria-hidden />
            {online ? "Payments are processed by Flutterwave, a licensed payment provider. TapIn never sees or stores your card details." : "We'll email you an invoice with bank details. Online payment by card, transfer and USSD is coming soon."}
          </p>
          <BookDemo label="Prefer to see it first? Book a free demo" className="btn btn-ghost" />
        </aside>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------- Parents

function ParentTab({ online }: { online: boolean }) {
  const [code, setCode] = useState("");
  const [sid, setSid] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<PayMethod>("card");
  const [found, findAction, finding] = useActionState<PayState, FormData>(findChild, {});
  const [paid, payAction, paying] = useActionState<PayState, FormData>(payChildFee, {});
  const child = found.data as FoundChild | undefined;
  const e = { ...(found.errors ?? {}), ...(paid.errors ?? {}) };
  const canPay = !!child && child.fee !== null && online;

  return (
    <section className="wrap" style={{ paddingTop: 56, paddingBottom: 112, display: "flex", flexWrap: "wrap", gap: 32, alignItems: "flex-start" }}>
      <div style={{ flex: "1.3 1 480px", minWidth: 0, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 28, padding: "clamp(24px, 4vw, 40px)", display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 className="jk" style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" }}>Pay your child&apos;s TapIn fee</h2>
          <p style={{ margin: 0, fontSize: 16, color: "var(--slate)" }}>Use the school code and student ID on the school&apos;s letter, and the phone number the school has for you.</p>
        </div>
        <form action={findAction} noValidate style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {e._form && <p className="err" role="alert">{e._form}</p>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 18 }}>
            <Field id="p-school" name="school_code" label="School code" placeholder="e.g. GFA-ABJ" value={code} onChange={(ev) => setCode(ev.target.value.toUpperCase())} error={e.school_code} />
            <Field id="p-student" name="student_id" label="Student ID" placeholder="e.g. STU0012" value={sid} onChange={(ev) => setSid(ev.target.value)} error={e.student_id} />
            <Field id="p-phone" name="phone" label="Your phone number" type="tel" inputMode="tel" placeholder="080..." autoComplete="tel" value={phone} onChange={(ev) => setPhone(ev.target.value)} error={e.phone} />
          </div>
          <button type="submit" className="btn btn-teal" disabled={finding} style={{ alignSelf: "flex-start" }}>{finding ? "Checking…" : "Find my child"}</button>
        </form>

        {child && (
          <form action={payAction} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <input type="hidden" name="school_code" value={code} />
            <input type="hidden" name="student_id" value={sid} />
            <input type="hidden" name="phone" value={phone} />
            <input type="hidden" name="method" value={method} />
            <div role="status" style={{ border: "1px solid var(--line-2)", background: "var(--mint-2)", borderRadius: 20, padding: 20, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", animation: "site-pop 420ms cubic-bezier(0.3, 1.4, 0.5, 1) both" }}>
              <span className="jk" style={{ flex: "none", width: 60, height: 60, borderRadius: 999, background: "var(--mint)", border: "3px solid var(--teal)", color: "var(--teal)", fontSize: 22, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{child.first.slice(0, 1)}</span>
              <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                <p className="jk" style={{ margin: 0, fontSize: 19, fontWeight: 800 }}>{child.first}</p>
                <p style={{ margin: 0, fontSize: 14, color: "var(--slate)" }}>{[child.className, child.schoolName].filter(Boolean).join(" · ")}</p>
              </div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--ink-green)", background: "var(--badge-in)", padding: "6px 12px", borderRadius: 999 }}>Student found</p>
            </div>
            {canPay ? (
              <>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Payment method</p>
                <Methods value={method} onChange={setMethod} />
                <button type="submit" className="btn btn-gold jk" disabled={paying} style={{ height: 56, fontSize: 17, fontWeight: 800 }}>
                  {paying ? "Opening the payment page…" : `Pay ${naira(child.fee!)} securely`}
                </button>
              </>
            ) : (
              <p style={{ margin: 0, fontSize: 15, color: "var(--slate)" }}>
                {child.fee === null ? `${child.schoolName} hasn't set up online payment for parents. Please pay at the school office.` : "Online payment isn't switched on yet. Please pay at the school office for now."}
              </p>
            )}
          </form>
        )}
      </div>

      <aside style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ background: "var(--deep)", color: "#fff", borderRadius: 28, padding: 32, display: "flex", flexDirection: "column", gap: 18 }}>
          <h2 className="jk" style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>This term&apos;s fee</h2>
          <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 12, fontSize: 15 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><dt style={{ color: "var(--on-deep)" }}>Student</dt><dd style={{ margin: 0, fontWeight: 700 }}>{child?.first ?? "—"}</dd></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><dt style={{ color: "var(--on-deep)" }}>Covers</dt><dd style={{ margin: 0, fontWeight: 700, textAlign: "right" }}>Arrival, departure and absence alerts</dd></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><dt style={{ color: "var(--on-deep)" }}>Pay with</dt><dd style={{ margin: 0, fontWeight: 700 }}>{METHODS.find((m) => m.id === method)!.name}</dd></div>
          </dl>
          <div style={{ borderTop: "1px solid #2A5652", paddingTop: 16, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 15, color: "var(--on-deep)" }}>Amount</span>
            <span className="jk" style={{ fontSize: 32, fontWeight: 800 }}>{child?.fee ? naira(child.fee) : "—"}</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "var(--on-deep)" }}>Find your child first. You&apos;ll get a receipt as soon as the payment is confirmed.</p>
        </div>
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 24, padding: 24, display: "flex", flexDirection: "column", gap: 8 }}>
          <p className="jk" style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>Can&apos;t find your child?</p>
          <p style={{ margin: 0, fontSize: 15, color: "var(--slate)" }}>Check the codes on the school&apos;s letter, and use the phone number you gave the school. Or ask the school office.</p>
        </div>
      </aside>
    </section>
  );
}
