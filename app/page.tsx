import type { Metadata } from "next";
import Link from "next/link";
import { Ripple } from "@/components/brand/ripple";
import { Reveal } from "@/components/home/reveal";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { BookDemo } from "@/components/site/book-demo";
import { CountUp } from "@/components/site/count-up";
import { naira } from "@/lib/pricing";
import { loadPricing } from "@/lib/pricing-data";
import "./site.css";

// Signed-in staff and parents never see this page: proxy.ts sends them to their own home first.
export const metadata: Metadata = {
  title: { absolute: "TapIn · School attendance that keeps every child accounted for" },
  description: "Students tap their ID card. The kiosk greets them by name, records attendance, and tells their parents in seconds.",
  robots: { index: true, follow: true },
};

const d = (i: number) => ({ "--i": i }) as React.CSSProperties;
const Tick = ({ c = "#5EEAD4", s = 18 }: { c?: string; s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12l5 5L20 7" /></svg>
);
const Icon = ({ children, color = "#0F766E" }: { children: React.ReactNode; color?: string }) => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
);

const FEATURES: { title: string; body: string; icon: React.ReactNode; warn?: boolean }[] = [
  { title: "Photo check at the gate", body: "Every tap shows the cardholder's photo, so a borrowed card is spotted straight away.", icon: <Icon><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M6 16c.8-1.4 1.8-2 3-2s2.2.6 3 2" /><path d="M15 10h3M15 13h3" /></Icon> },
  { title: "A warm voice greeting", body: "“Good morning, David.” “Goodbye, take care.” Children hear their name every day.", icon: <Icon><path d="M11 5L6 9H3v6h3l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></Icon> },
  { title: "Arrival and departure alerts", body: "Parents get the exact time their child signed in and out, by WhatsApp or SMS, under the school's own name.", icon: <Icon><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></Icon> },
  { title: "Automatic absence alerts", body: "Not in by the cutoff? Parents are asked to check in. Weekends and holidays are skipped.", warn: true, icon: <Icon color="#B45309"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></Icon> },
  { title: "Keeps working offline", body: "Network down? The kiosk still greets every child and sends everything once it reconnects.", icon: <Icon><path d="M2 8.8a15 15 0 0 1 20 0" /><path d="M5 12.5a10 10 0 0 1 14 0" /><path d="M8.5 16a5 5 0 0 1 7 0" /><circle cx="12" cy="19.5" r="1" /></Icon> },
  { title: "Live dashboard for principals", body: "Who is present, absent or late, by class, in real time. Export termly reports in one click.", icon: <Icon><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Icon> },
  { title: "Staff attendance too", body: "Teachers tap the same kiosk. Punctuality reports for staff with no extra hardware.", icon: <Icon><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.3-5.5 6.5-5.5s5.7 2 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M18 14.8c2 .6 3.2 2.4 3.5 5.2" /></Icon> },
  { title: "Private and secure", body: "Each school's data is locked to that school. Lost cards are blocked in seconds.", icon: <Icon><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></Icon> },
];

const TAPS = [
  { i: "DB", name: "David Bello", cls: "JSS 1B", t: "7:51", late: true },
  { i: "AI", name: "Amina Ibrahim", cls: "SS 1A", t: "7:44" },
  { i: "CO", name: "Chioma Okafor", cls: "JSS 2A", t: "7:42" },
  { i: "MA", name: "Mrs. Adeyemi", cls: "Staff", t: "7:30", staff: true },
];

export default async function Home() {
  const pricing = await loadPricing();
  const plans = pricing.plans;
  const live = pricing.liveWithinDays;
  return (
    <main id="main" className="site">
      <Reveal />

      {/* HERO */}
      <section className="site-dark">
        <div className="hero-grid" aria-hidden />
        <SiteHeader active="home" />
        <div className="wrap hero">
          <div className="hero-copy load-in">
            <p className="pill"><span className="dot" />Smart attendance for Nigerian schools</p>
            <h1>Every child, <span className="tapin-gold gold-bright">accounted for.</span> From the school gate to the parent&apos;s phone.</h1>
            <p className="lead">Students tap their ID card. The kiosk greets them by name, records attendance, and tells their parents in seconds. Absent children are flagged automatically.</p>
            <div className="hero-actions" style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
              <BookDemo />
              <Link href="/pricing" className="btn btn-ghost">See pricing</Link>
            </div>
            <div className="ticks">
              <span><Tick />Works offline</span>
              <span><Tick />WhatsApp or SMS to any phone</span>
              <span><Tick />Set up in days</span>
            </div>
          </div>

          <div className="hero-visual">
            <div className="device">
              <div className="screen" role="img" aria-label="The TapIn kiosk greeting Chioma Okafor at 7:42 AM">
                <div className="screen-top"><span>Main gate</span><span>7:42 AM</span></div>
                <div className="avatar-wrap"><Ripple rings={3} durationMs={3000} still={0} /><div className="avatar">CO</div></div>
                <div style={{ textAlign: "center" }}>
                  <p className="jk" style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" }}>Chioma Okafor</p>
                  <p style={{ margin: "2px 0 0", fontSize: 15, color: "var(--slate-2)" }}>JSS 2A</p>
                </div>
                <p className="signed"><Tick c="#166534" s={16} />Signed in</p>
                <p className="quote">“Good morning, Chioma. Welcome to school.”</p>
                <div className="tap-hint">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0F766E" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M8.5 9a4 4 0 0 1 0 6" /><path d="M12 6.5a8 8 0 0 1 0 11" /><path d="M15.5 4a12 12 0 0 1 0 16" /></svg>
                  Tap your card to sign in
                </div>
              </div>
            </div>
            <div className="sms-toast" aria-hidden>
              <div className="sms-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg></div>
              <div>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "var(--slate-2)" }}>WhatsApp · now</p>
                <p style={{ margin: "2px 0 0", fontSize: 14, fontWeight: 500, lineHeight: 1.4 }}>TapIn: Chioma arrived at school at 7:42 AM.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TRUST STRIP */}
      <section className="trust" aria-label="Why schools choose TapIn">
        <div className="wrap grid">
          <div data-reveal><b>Seconds, not minutes</b><span>From card tap to the parent&apos;s message on a normal connection</span></div>
          <div data-reveal style={d(1)}><b>No internet? No problem</b><span>Taps are saved on the kiosk and sent when the network returns</span></div>
          <div data-reveal style={d(2)}><b>Any phone</b><span>Parents need no app. Alerts arrive by WhatsApp or SMS</span></div>
          <div data-reveal style={d(3)}><b>Data protected</b><span>Built to Nigeria Data Protection Act standards</span></div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="wrap section" aria-labelledby="how-h">
        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 640 }} data-reveal>
          <p className="eyebrow">How it works</p>
          <h2 id="how-h" className="big">One tap does the whole morning register.</h2>
        </div>
        <div className="grid3">
          {[
            ["01", "Tap the ID card", "Each student and teacher gets a smart ID card. They tap it on the kiosk at the gate. No queues, no paper register."],
            ["02", "Greeted and recorded", "The screen shows their photo so the gate staff can check it, says good morning by name, and saves the exact time."],
            ["03", "Parents are told", "Parents get a message when their child arrives and leaves. If a child hasn't arrived by the cutoff time, parents are alerted."],
          ].map(([n, t, b], i) => (
            <div key={n} className="card" data-reveal style={d(i)}>
              <p className="num">{n}</p><h3>{t}</h3><p>{b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="features" aria-labelledby="feat-h">
        <div className="wrap section" style={{ paddingBottom: 112 }}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 24 }} data-reveal>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 620 }}>
              <p className="eyebrow">What you get</p>
              <h2 id="feat-h" className="big">Everything a school needs to know who is in, and who is not.</h2>
            </div>
            <p style={{ margin: 0, maxWidth: 360, fontSize: 16, color: "var(--slate)" }}>Kiosk, cards, software, alerts and setup. One service, one bill.</p>
          </div>
          <div className="feat-grid">
            {FEATURES.map((f, i) => (
              <div key={f.title} className="feat" data-reveal style={d(i % 4)}>
                <div className={`ficon${f.warn ? " warn" : ""}`}>{f.icon}</div>
                <h3>{f.title}</h3><p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DASHBOARD PREVIEW */}
      <section className="wrap pad" style={{ paddingTop: 112, paddingBottom: 112, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 56 }} aria-labelledby="dash-h">
        <div style={{ flex: "1 1 340px", minWidth: 0, display: "flex", flexDirection: "column", gap: 18 }} data-reveal>
          <p className="eyebrow">For school leaders</p>
          <h2 id="dash-h" className="big" style={{ fontSize: "clamp(32px, 3.6vw, 44px)" }}>Know your school&apos;s attendance before assembly starts.</h2>
          <p style={{ margin: 0, fontSize: 17, color: "var(--slate)" }}>The dashboard updates with every tap. See late arrivals, chase absences, and print class registers without collecting a single paper sheet.</p>
          <div style={{ marginTop: 8 }}><BookDemo label="See a live demo" className="btn btn-teal" /></div>
        </div>
        <div className="panel" style={{ flex: "1.4 1 520px", minWidth: 0 }} data-reveal data-ui>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <p className="jk" style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Today · Main campus</p>
            <p className="chip">Sample data</p>
          </div>
          <div className="kpis">
            <div className="kpi green"><p>Present</p><b><CountUp value={412} /></b></div>
            <div className="kpi red"><p>Absent</p><b><CountUp value={18} /></b></div>
            <div className="kpi amber"><p>Late</p><b><CountUp value={9} /></b></div>
            <div className="kpi teal"><p>Staff in</p><b><CountUp value={31} /></b></div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 700, color: "var(--slate-2)" }}>Live taps</p>
            {TAPS.map((t, i) => (
              <div key={t.name} className="tap-row" style={d(i)}>
                <span className="initials" style={t.staff ? { background: "var(--badge-late)", color: "var(--ink-amber)" } : undefined}>{t.i}</span>
                <span style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>{t.name} <span style={{ fontWeight: 400, color: "var(--slate-2)" }}>· {t.cls}</span></span>
                <span style={{ fontSize: 13, color: "var(--slate-2)" }}>{t.t}</span>
                <span className={`badge ${t.late ? "late" : "in"}`}>{t.late ? "Late" : "In"}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PARENTS */}
      <section id="parents" className="parents" aria-labelledby="par-h">
        <div className="wrap pad" style={{ paddingTop: 112, paddingBottom: 112, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 56 }}>
          <div style={{ flex: "1 1 380px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="bubble" data-reveal>TapIn: Chioma arrived at school at 7:42 AM.</div>
            <div className="bubble" data-reveal style={d(3)}>TapIn: Chioma left school at 2:10 PM. Have a good evening.</div>
            <div className="bubble warn" data-reveal style={d(6)}>TapIn: David has not arrived at school today. Please contact the school if you were not expecting this.</div>
          </div>
          <div style={{ flex: "1 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }} data-reveal>
            <p className="eyebrow" style={{ color: "var(--mint)" }}>For parents</p>
            <h2 id="par-h" className="big">Peace of mind, every school day.</h2>
            <p style={{ margin: 0, fontSize: 18, color: "#D5F3EE" }}>You&apos;ll know your child got to school safely, and when they left. No app to install. Just a message on the phone you already have.</p>
            <Link href="/pricing?for=parents" className="btn btn-white" style={{ alignSelf: "flex-start", marginTop: 8 }}>Pay your child&apos;s TapIn fee</Link>
          </div>
        </div>
      </section>

      {/* PRICING TEASER */}
      <section className="wrap section" style={{ gap: 48, paddingBottom: 112 }} aria-labelledby="price-h">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }} data-reveal>
          <p className="eyebrow">Pricing</p>
          <h2 id="price-h" className="big" style={{ maxWidth: 680 }}>Simple plans. Priced per student, per term.</h2>
        </div>
        <div className="grid3" style={{ alignItems: "stretch" }}>
          {plans.map((p, i) => (
            <div key={p.id} className={`plan${p.popular ? " featured" : ""}`} data-reveal style={d(i)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <p className="name">{p.name}</p>{p.popular && <p className="popular">Most popular</p>}
              </div>
              <p className="blurb">{p.blurb}</p>
              <p className="price">
                {p.custom ? "Custom" : p.termPrice === null ? "Price on request" : <>{naira(p.termPrice)}<small> / student / term</small></>}
              </p>
              <ul>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
              <Link href={p.custom ? "/#demo" : `/pricing?plan=${p.id}`} className={`btn ${p.popular ? "btn-gold" : "btn-line"}`} style={{ marginTop: "auto", padding: "14px 20px" }}>
                {p.custom ? "Talk to us" : `Choose ${p.name}`}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section style={{ background: "var(--card)", borderTop: "1px solid var(--line)" }} aria-labelledby="faq-h">
        <div className="wrap pad" style={{ maxWidth: 820, paddingTop: 112, paddingBottom: 112, display: "flex", flexDirection: "column", gap: 32 }}>
          <h2 id="faq-h" className="jk" style={{ margin: 0, textAlign: "center", fontSize: "clamp(30px, 3.2vw, 40px)", fontWeight: 800, letterSpacing: "-0.03em" }} data-reveal>Questions schools ask</h2>
          <div data-reveal>
            <details><summary>What happens if the internet goes down?</summary><p>The kiosk keeps working. It greets each child, saves every tap, and sends the records and parent messages as soon as the connection returns.</p></details>
            <details><summary>Do parents need a smartphone?</summary><p>No. Alerts arrive by WhatsApp, or as a normal SMS on any phone.</p></details>
            <details><summary>What if a student loses their card?</summary><p>The admin blocks the old card from the dashboard in seconds and links a new one to the same student.</p></details>
            <details><summary>Is our students&apos; data safe?</summary><p>Each school&apos;s data is kept separate and only staff you approve can see it. We follow the Nigeria Data Protection Act and record parental consent before any photo is added.</p></details>
            <details><summary>How long does setup take?</summary><p>We install the kiosk, print the cards and register your students{live ? `. Most schools are live within ${live} days.` : ", usually within a few days."}</p></details>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section id="demo" className="wrap pad" style={{ paddingTop: 96, paddingBottom: 96 }} aria-labelledby="cta-h">
        <div className="cta" data-reveal>
          <div className="waves" aria-hidden><Ripple rings={4} durationMs={4800} still={3} /></div>
          <div style={{ flex: "1 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 id="cta-h" className="jk" style={{ margin: 0, fontSize: "clamp(30px, 3.4vw, 44px)", lineHeight: 1.1, fontWeight: 800, letterSpacing: "-0.03em" }}>See TapIn at your school gate.</h2>
            <p style={{ margin: 0, fontSize: 18, color: "var(--on-deep)" }}>We&apos;ll bring a kiosk and sample cards to your school for a free demo.</p>
          </div>
          <div className="cta-actions" style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            <BookDemo />
            {pricing.contact.whatsapp && (
              <a href={`https://wa.me/${pricing.contact.whatsapp}`} className="btn btn-ghost" target="_blank" rel="noreferrer">Chat on WhatsApp</a>
            )}
          </div>
        </div>
      </section>

      <SiteFooter contact={pricing.contact} />
    </main>
  );
}
