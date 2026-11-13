import type { Metadata } from "next";
import Link from "next/link";
import { Logo, TapInWord } from "@/components/brand/logo";
import { Reveal } from "@/components/home/reveal";
import { BookDemo } from "@/components/site/book-demo";
import { ThemeCycleButton, ThemeToggle } from "@/components/theme/theme";
import { GateDemo } from "@/components/home/gate-demo";
import { GateFlow } from "@/components/home/gate-flow";
import { BlockMark } from "@/components/home/block-mark";
import {
  IdCardFrag, KioskFrag, KpiFrag, LessonFrag, OfflineFrag, PickupFrag, RegisterFrag, RollFrag, SmsFrag, WhatsAppFrag,
} from "@/components/home/fragments";
import { naira } from "@/lib/pricing";
import { loadPricing } from "@/lib/pricing-data";
import "./site.css";
import "./home.css";

// Signed-in staff and parents never see this page: proxy.ts sends them to their own home first.
export const metadata: Metadata = {
  title: { absolute: "TapIn · School attendance that keeps every child accounted for" },
  description: "Students tap their ID card. The kiosk greets them by name, records attendance, and tells their parents in seconds.",
  robots: { index: true, follow: true },
};

const d = (i: number) => ({ "--i": i }) as React.CSSProperties;

/** One frame of the hero sheet: a piece of TapIn at work, with its moment written on a strip beneath. */
function Frame({ strip, tone, children, label }: { strip?: string; tone: 0 | 1 | 2 | 3; children: React.ReactNode; label?: string }) {
  return (
    <figure className="frame" role={label ? "img" : undefined} aria-label={label}>
      <div className={strip ? "frame-body" : "frame-body whole"}>{children}</div>
      {strip && <figcaption className={`strip s${tone}`}>{strip}</figcaption>}
    </figure>
  );
}

const COL_A = [
  <Frame key="a1" strip="Staff room · 8:15 AM" tone={2}><LessonFrag teacher="Mrs. Adeyemi" subject="Mathematics" cls="JSS 2A" minutes={23} /></Frame>,
  <Frame key="a2" strip="Main gate · 7:31 AM" tone={0}><KioskFrag name="Amina Ibrahim" cls="SS 1A" time="7:31 AM" /></Frame>,
  <Frame key="a3" strip="SMS · 9:00 AM" tone={1}><SmsFrag from="BRIGHTSTAR" time="9:00 AM" text="David Bello has not arrived at school today. Please contact the school if you were not expecting this." /></Frame>,
  <Frame key="a4" strip="Student ID card" tone={3}><IdCardFrag name="Tobi Adeleke" no="BSC/2026/0142" school="Bright Stars College" /></Frame>,
];
const COL_B = [
  <Frame key="b1" strip="WhatsApp · Mrs Okafor" tone={1}><WhatsAppFrag to="Bright Stars College" lines={[{ text: "Chioma arrived at school at 7:42 AM.", time: "7:42" }, { text: "Chioma left school at 2:10 PM.", time: "14:10" }]} /></Frame>,
  <Frame key="b2" strip="Today · 8:30 AM" tone={2}><KpiFrag present={412} absent={18} late={9} staff={31} /></Frame>,
  <Frame key="b3" strip="Main gate · 8:04 AM" tone={0}><KioskFrag name="Tobi Adeleke" cls="JSS 3B" time="8:04 AM" tone="late" /></Frame>,
  <Frame key="b4" strip="Fire drill · 11:20 AM" tone={3}><RollFrag safe={412} total={430} /></Frame>,
];
const MID_TOP = [
  <Frame key="m1" tone={3}><IdCardFrag name="Chioma Okafor" no="BSC/2026/0011" school="Bright Stars College" /></Frame>,
  <Frame key="m2" tone={1}><OfflineFrag saved={14} /></Frame>,
];
const MID_BOTTOM = [
  <Frame key="m3" strip="JSS 2A register · 8:05 AM" tone={0}><RegisterFrag title="JSS 2A · Monday" rows={[{ name: "Chioma Okafor", time: "7:42", state: "In" }, { name: "Emeka Nwosu", time: "7:50", state: "In" }, { name: "Tobi Adeleke", time: "8:04", state: "Late" }, { name: "David Bello", time: "—", state: "Absent" }]} /></Frame>,
  <Frame key="m4" strip="Pickup · 2:10 PM" tone={2}><PickupFrag person="Ngozi Eze" relation="Aunt" kids={["Ada", "Kelechi"]} time="2:10 PM" /></Frame>,
];
const COL_C = [
  <Frame key="c1" strip="Main gate · 7:42 AM" tone={0} label="The TapIn kiosk greeting Chioma Okafor at 7:42 AM"><KioskFrag name="Chioma Okafor" cls="JSS 2A" time="7:42 AM" greeting="Good morning, Chioma. Welcome to school." /></Frame>,
  <Frame key="c2" strip="WhatsApp · Mr Bello" tone={1}><WhatsAppFrag to="Bright Stars College" lines={[{ text: "David has not arrived at school today.", time: "9:00", warn: true }]} /></Frame>,
  <Frame key="c3" strip="Today · 8:30 AM" tone={2}><KpiFrag present={198} absent={6} late={4} staff={14} /></Frame>,
];
const COL_D = [
  <Frame key="d1" strip="Back gate · 2:05 PM" tone={3}><KioskFrag name="Emeka Nwosu" cls="JSS 2A" time="2:05 PM" tone="out" place="Back gate" /></Frame>,
  <Frame key="d2" strip="SS 1A register · 8:10 AM" tone={0}><RegisterFrag title="SS 1A · Monday" rows={[{ name: "Amina Ibrahim", time: "7:31", state: "In" }, { name: "Zainab Musa", time: "7:38", state: "In" }, { name: "Fatima Sani", time: "8:09", state: "Late" }]} /></Frame>,
  <Frame key="d3" strip="Staff room · 10:40 AM" tone={2}><LessonFrag teacher="Mr. Okon" subject="Basic Science" cls="JSS 1A" minutes={38} /></Frame>,
  <Frame key="d4" strip="WhatsApp · Mrs Musa" tone={1}><WhatsAppFrag to="Bright Stars College" lines={[{ text: "Zainab arrived at school at 7:38 AM.", time: "7:38" }]} /></Frame>,
];

const FEATURES: { title: string; body: string; frag: React.ReactNode }[] = [
  { title: "The face on the card", body: "Every tap shows the child's photo, so gate staff spot a borrowed card at once.", frag: <KioskFrag name="Zainab Musa" cls="SS 1A" time="7:38 AM" greeting="Good morning, Zainab." /> },
  { title: "Parents told in seconds", body: "Arrival and departure times by WhatsApp or SMS, sent under your school's own name.", frag: <WhatsAppFrag to="Bright Stars College" lines={[{ text: "Chioma arrived at school at 7:42 AM.", time: "7:42" }, { text: "Chioma left school at 2:10 PM.", time: "14:10" }]} /> },
  { title: "Absences chased for you", body: "Not in by the cutoff? The parent gets a message. Weekends and holidays are skipped.", frag: <SmsFrag from="BRIGHTSTAR" time="9:00 AM" text="David Bello has not arrived at school today. Please contact the school if you were not expecting this." /> },
  { title: "The register, live", body: "Present, late and absent for every class before assembly. Export the term in one click.", frag: <RegisterFrag title="JSS 2A · Monday" rows={[{ name: "Chioma Okafor", time: "7:42", state: "In" }, { name: "Emeka Nwosu", time: "7:50", state: "In" }, { name: "Tobi Adeleke", time: "8:04", state: "Late" }, { name: "David Bello", time: "—", state: "Absent" }]} /> },
  { title: "Safe pickup", body: "Only people the parents approve can collect a child. Staff see their photo and confirm.", frag: <PickupFrag person="Ngozi Eze" relation="Aunt" kids={["Ada", "Kelechi"]} time="2:10 PM" /> },
  { title: "Works through power cuts", body: "No network? The kiosk keeps greeting children and sends every tap when it reconnects.", frag: <OfflineFrag saved={14} /> },
];

const FAQ: [string, string][] = [
  ["What happens if the internet goes down?", "The kiosk keeps working. It greets each child, saves every tap with its real time, and sends the records and parent messages as soon as the connection returns."],
  ["Do parents need a smartphone?", "No. Alerts arrive by WhatsApp, or as a normal SMS on any phone. Parents choose which."],
  ["What hardware do we need?", "A kiosk at the gate (a tablet or phone with a card reader) and a smart ID card for every student and teacher. We install the kiosk and print the cards."],
  ["What if a student loses their card?", "The admin blocks the old card from the dashboard in seconds and links a new one to the same student."],
  ["Can teachers use it too?", "Yes. Teachers tap the same kiosk to sign in, and to start and end lessons. The head sees who is teaching and for how long, with a monthly report for each teacher."],
  ["Is our students' data safe?", "Each school's data is kept separate and only staff you approve can see it. We follow the Nigeria Data Protection Act and record parental consent before any photo is added."],
  ["Can it fill our school portal's register?", "Yes. Each sign-in can be sent to your own portal, so its class register marks the child present or late automatically."],
];

const PLAN_TONES = ["p0", "p1", "p2"] as const;

export default async function Home() {
  const pricing = await loadPricing();
  const plans = pricing.plans;
  const live = pricing.liveWithinDays;
  const faq = FAQ.concat([["How long does setup take?", `We install the kiosk, print the cards and register your students${live ? `. Most schools are live within ${live} days.` : ", usually within a few days."}`]]);

  return (
    <main id="main" className="site home">
      <Reveal />

      {/* HERO: a sheet of one school morning, with the name and the action in one cell. */}
      <section className="sheet" aria-labelledby="hero-h">
        <div className="sheet-col c1">{COL_A}</div>
        <div className="sheet-col c2">{COL_B}</div>
        <div className="sheet-mid">
          <div className="mid-top">{MID_TOP}</div>
          <div className="panel-cell">
            <Link href="/" className="panel-mark" aria-label="TapIn home">
              <Logo variant="inverse" className="size-9" title="" animated />
              <TapInWord onDark className="text-[28px]" />
            </Link>
            <h1 id="hero-h">Every child, accounted for.</h1>
            <p className="panel-lead">Children tap in at the school gate. Parents know within seconds.</p>
            <BookDemo className="btn btn-gold btn-block" />
            <nav className="panel-links" aria-label="Main">
              <Link href="#how">How it works</Link>
              <Link href="/pricing">Pricing</Link>
              <Link href="/login">Log in</Link>
              <ThemeCycleButton className="panel-theme" />
            </nav>
          </div>
          <div className="mid-bottom">{MID_BOTTOM}</div>
        </div>
        <div className="sheet-col c5">{COL_C}</div>
        <div className="sheet-col c6">{COL_D}</div>
      </section>

      {/* HOW IT WORKS: many into one. */}
      <section id="how" className="band" aria-labelledby="how-h">
        <div className="how-head" data-reveal>
          <h2 id="how-h">One tap does the whole register.</h2>
          <p>A crowd arrives at the gate. Each child taps once at the kiosk. By assembly, every class register is complete and every parent has been told.</p>
        </div>
        <GateFlow />
      </section>

      {/* FEATURES: staggered fragment cells. */}
      <section id="features" className="band" aria-labelledby="feat-h">
        <h2 id="feat-h" className="feat-h" data-reveal>Everything at the gate</h2>
        <div className="cells">
          {FEATURES.map((f, i) => (
            <article key={f.title} className={`cell ${(i < 3 ? i % 2 : (i + 1) % 2) ? "frag-top" : "text-top"}`} data-reveal style={d(i % 3)}>
              <div className="cell-text"><h3>{f.title}</h3><p>{f.body}</p></div>
              <div className="cell-frag" data-ui>{f.frag}</div>
            </article>
          ))}
        </div>
      </section>

      {/* SHOWCASE: the live thing. */}
      <section id="try" className="band try" aria-labelledby="try-h">
        <div className="try-head" data-reveal>
          <h2 id="try-h">Try the gate</h2>
          <p>Set a child and an arrival time. See what the kiosk shows, and what the parent receives.</p>
        </div>
        <GateDemo />
        <p className="try-note" data-reveal>Drag the time past the late time to see a late arrival. Switch the internet off to see a power cut.</p>
      </section>

      {/* PRICING: plans that step up. */}
      <section id="pricing" className="band" aria-labelledby="price-h">
        <div className="steps">
          <div className="steps-head" data-reveal>
            <h2 id="price-h">Priced per student, per term</h2>
            <p>Kiosk, cards, software, alerts and setup. One service, one bill. <Link href="/pricing?for=parents">Parents: pay the TapIn fee</Link></p>
          </div>
          {plans.map((p, i) => (
            <article key={p.id} className={`step ${PLAN_TONES[i % 3]}`} data-reveal style={d(i)}>
              <div className="step-body">
                <h3>{p.name}</h3>
                <p className="step-price">{p.custom ? "Custom" : p.termPrice === null ? "On request" : naira(p.termPrice)}</p>
                {!p.custom && p.termPrice !== null && <p className="step-unit">per student, per term</p>}
                <p className="step-blurb">{p.blurb}</p>
                <ul>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
              </div>
              <Link href={p.custom ? "#demo" : `/pricing?plan=${p.id}`} className="step-strip">{p.custom ? "Talk to us" : `Choose ${p.name}`}<span aria-hidden>→</span></Link>
            </article>
          ))}
        </div>
      </section>

      {/* FAQ: accordion of filled tiles. */}
      <section id="faq" className="band faq" aria-labelledby="faq-h">
        <h2 id="faq-h" data-reveal>Questions schools ask</h2>
        <div className="faq-list">
          {faq.map(([q, a], i) => (
            <details key={q} name="faq" data-reveal style={d(i % 4)}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA: the action tile. */}
      <section id="demo" className="cta-row" aria-labelledby="cta-h">
        <figure className="cta-flank left">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/home/lagos-gate-house-1978.jpg" width={1600} height={1102} loading="lazy" decoding="async"
            alt="Architect's plan of a Lagos school gate house, 1978: a check point between the lane in and the lane out" />
        </figure>
        <div className="cta-main" data-reveal>
          <div className="cta-copy">
          <h2 id="cta-h">See TapIn at your gate</h2>
          <p>We&apos;ll bring a kiosk and sample cards to your school for a free demo, and set it up on the spot.</p>
          <div className="cta-actions">
            <BookDemo className="btn btn-ink" />
            {pricing.contact.whatsapp && (
              <a href={`https://wa.me/${pricing.contact.whatsapp}`} className="btn btn-line-ink" target="_blank" rel="noreferrer">Chat on WhatsApp</a>
            )}
          </div>
          </div>
          <div className="cta-frag"><WhatsAppFrag to="Your school" lines={[{ text: "Your child arrived at school at 7:36 AM.", time: "7:36" }, { text: "Your child left school at 2:10 PM.", time: "14:10" }]} /></div>
        </div>
        <div className="cta-flank right" aria-hidden />
      </section>

      {/* FOOTER: the mark, built large. */}
      <footer className="foot" data-reveal>
        <BlockMark />
        <div className="foot-cols">
          <div><p className="foot-h">Product</p><Link href="#how">How it works</Link><Link href="#features">Features</Link><Link href="#try">Try the gate</Link><Link href="/pricing">Pricing</Link></div>
          <div><p className="foot-h">Parents</p><Link href="/parent/login">Parent log in</Link><Link href="/pricing?for=parents">Pay the TapIn fee</Link></div>
          <div><p className="foot-h">Schools</p><Link href="/login">Staff log in</Link><Link href="/privacy">Privacy notice</Link></div>
          <div className="foot-contact">
            <p className="foot-h">Contact</p>
            <span>{pricing.contact.city}</span>
            {pricing.contact.phone && <a href={`tel:${pricing.contact.phone.replace(/\s/g, "")}`}>{pricing.contact.phone}</a>}
            {pricing.contact.email && <a href={`mailto:${pricing.contact.email}`}>{pricing.contact.email}</a>}
          </div>
        </div>
        <div className="foot-last">
          <span>© 2026 TapIn. Every child, accounted for.</span>
          <span className="foot-credit">Gate house plan, Lagos, 1978: <a href="https://commons.wikimedia.org/wiki/File:Lagos_State_College_Of_Science_Tech_Nigeria_Designed_by_Michael_Olutusen_Onafowokan_Gate_House_Drwg_38_038.jpg" target="_blank" rel="noreferrer">Onafowokan Michael Olutusen</a>, CC BY-SA 4.0, via Wikimedia Commons</span>
          <ThemeToggle />
        </div>
      </footer>
    </main>
  );
}
