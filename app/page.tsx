import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CloudOff, KeyRound } from "lucide-react";
import { Wordmark } from "@/components/brand/logo";
import { Reveal } from "@/components/home/reveal";
import { Showcase } from "@/components/home/live-greeting";
import { SchoolDay } from "@/components/home/school-day";
import { DemoCoupon } from "@/components/home/demo-coupon";
import "./home.css";

// Signed-in staff and parents never see this page: proxy.ts sends them to their own home first.
export const metadata: Metadata = {
  title: { absolute: "TapIn · NFC attendance for Nigerian schools" },
  description: "Children tap an ID card at the school gate, the kiosk greets them by name, and parents get a WhatsApp the same minute.",
  robots: { index: true, follow: true },
};

const d = (i: number) => ({ "--i": i }) as React.CSSProperties;

export default function Home() {
  return (
    <main id="main" className="home">
      <Reveal />

      {/* Hero: the waterline. Above it the school, below it the parent's phone. */}
      <section className="hero" aria-labelledby="hero-h">
        <div className="field-top" aria-hidden />
        <div className="field-bottom" aria-hidden />
        <div className="bar">
          <Link href="/" aria-label="TapIn home"><Wordmark className="text-base" /></Link>
          <div className="bar-actions">
            <Link href="/login" className="signin link">Sign in</Link>
            <a href="#demo" className="btn">Book a demo</a>
          </div>
        </div>
        <div className="headline heavy">
          <h1 id="hero-h" className="copy">
            <span className="line"><span>Every child</span></span>
            <span className="line"><span className="split">counted.</span></span>
          </h1>
        </div>
        <p className="support">
          TapIn is NFC attendance for Nigerian schools: a tap at the gate, a greeting by name, and a WhatsApp to the parent
          in the same minute.
        </p>
      </section>

      <Showcase />

      {/* One photograph across the page, with its caption on a solid bar. */}
      <section className="band" aria-labelledby="band-h">
        <div className="band-pic">
          <Image src="/home/western-education-in-northern-nigeria-03.jpg" alt="Pupils in blue uniforms lining up outside their classroom in the morning" fill sizes="100vw" />
        </div>
        <div className="band-cap" data-reveal>
          <h2 id="band-h" className="heavy">Every morning, every child</h2>
          <p>Hundreds of children come through one gate in half an hour. TapIn reads a card in under a second, so the line keeps moving and nobody is missed.</p>
        </div>
      </section>

      {/* The school day */}
      <section className="day wrap" aria-labelledby="day-h">
        <div className="intro grid12">
          <h2 id="day-h" className="heavy" data-reveal>The school day</h2>
          <p data-reveal style={d(1)}>
            From the first child at the gate to the head teacher&apos;s report, TapIn keeps the register for you. Choose a
            part of the day to see what happens.
          </p>
        </div>
        <div data-reveal style={d(2)}><SchoolDay /></div>
      </section>

      {/* Board of close-ups from the product */}
      <section className="board-section" aria-labelledby="board-h">
        <div className="board">
          <div className="tile t62" style={{ "--t-bg": "var(--paper-2)", "--t-ink": "var(--h-ink)" } as React.CSSProperties} data-reveal>
            <h2 id="board-h" className="heavy">School mornings</h2>
          </div>
          <div className="tile t62" style={{ "--t-bg": "#cdeee6", "--t-ink": "#03201e" } as React.CSSProperties} data-reveal data-ui-tile>
            <div className="el" data-ui style={{ fontSize: "clamp(22px, 2.6vw, 40px)", top: "14%", right: "-0.4em", display: "flex" }}>
              {["AE", "KA", "TB", "DB", "CO"].map((x, i) => <span key={x} className="ui-disc" style={{ marginLeft: i ? "-0.4em" : 0 }}>{x}</span>)}
            </div>
            <div className="cap"><b>Who is missing, by 9:00</b><span>Absent pupils listed for each class teacher.</span></div>
          </div>
          <div className="tile t64" style={{ "--t-bg": "#03201e", "--t-ink": "#f4f6f5" } as React.CSSProperties} data-reveal>
            <div className="el" data-ui style={{ fontSize: "clamp(18px, 2.4vw, 36px)", top: "18%", left: "8%" }}>
              <span className="ui-pill" style={{ background: "#fbbf24", color: "#451a03" }}><CloudOff style={{ width: "1em", height: "1em" }} aria-hidden /> Offline: taps are being saved (3)</span>
            </div>
            <div className="cap"><b>Works when the internet doesn&apos;t</b><span>Taps are kept on the kiosk and sent the moment it reconnects.</span></div>
          </div>
          <div className="tile t34" style={{ "--t-bg": "#0f766e", "--t-ink": "#f4f6f5" } as React.CSSProperties} data-reveal>
            <div className="el" data-ui style={{ fontSize: "clamp(22px, 3vw, 48px)", top: "16%", left: "-0.3em", display: "grid", gap: "0.35em", fontWeight: 700 }}>
              <span>WhatsApp <span className="ui-switch" style={{ background: "#e8a317" }} /></span>
              <span style={{ opacity: 0.7 }}>SMS</span>
            </div>
            <div className="cap"><b>WhatsApp or SMS</b><span>Each parent chooses how to hear.</span></div>
          </div>
          <div className="tile t32" style={{ "--t-bg": "#e8a317", "--t-ink": "#1a1204" } as React.CSSProperties} data-reveal>
            <div className="el" data-ui style={{ fontSize: "clamp(16px, 1.8vw, 28px)", top: "14%", right: "-1.2em" }}>
              <span className="ui-pill" style={{ background: "#451a03", color: "#fde68a" }}>Late arrival · 7:46</span>
            </div>
            <div className="cap"><b>Late, marked kindly</b><span>After resumption time.</span></div>
          </div>
          <div className="tile t32" style={{ "--t-bg": "#063b36", "--t-ink": "#f4f6f5" } as React.CSSProperties} data-reveal>
            <div className="el" data-ui style={{ fontSize: "clamp(16px, 1.8vw, 28px)", top: "14%", left: "-0.6em" }}>
              <span className="ui-pill" style={{ background: "#fecaca", color: "#7f1d1d" }}>Card blocked</span>
            </div>
            <div className="cap"><b>Lost card? Blocked at once</b><span>And a new one assigned.</span></div>
          </div>
          <div className="tile t34" style={{ "--t-bg": "var(--paper-2)", "--t-ink": "var(--h-ink)" } as React.CSSProperties} data-reveal>
            <div className="el" data-ui style={{ fontSize: "clamp(20px, 2.6vw, 42px)", top: "14%", left: "10%", display: "flex", gap: "0.4em" }}>
              <span className="ui-key">Excel</span><span className="ui-key">PDF</span>
            </div>
            <div className="cap"><b>Reports in one click</b><span>Any week, any term, any class.</span></div>
          </div>
          <div className="tile t32" style={{ "--t-bg": "#0b1716", "--t-ink": "#f4f6f5" } as React.CSSProperties} data-reveal>
            <div className="el" data-ui style={{ fontSize: "clamp(18px, 2.2vw, 34px)", top: "12%", right: "-0.5em", display: "flex", gap: "0.25em", alignItems: "center" }}>
              <KeyRound style={{ width: "1em", height: "1em", color: "#e8a317" }} aria-hidden />
              {["4", "8", "2", "9", "1", "3"].map((n, i) => <span key={i} className="ui-key" style={{ minWidth: "1.6em", height: "1.9em" }}>{n}</span>)}
            </div>
            <div className="cap"><b>Two-factor login</b><span>For every staff account.</span></div>
          </div>
          <div className="tile t32" style={{ "--t-bg": "#cdeee6", "--t-ink": "#03201e" } as React.CSSProperties} data-reveal>
            <div className="el" data-ui style={{ fontSize: "clamp(16px, 1.8vw, 28px)", top: "14%", left: "8%" }}>
              <span className="ui-pill" style={{ background: "#0f766e", color: "#fff" }}>Signed out · Early release</span>
            </div>
            <div className="cap"><b>Early pick-up, recorded</b><span>With the reason, for the parent.</span></div>
          </div>
          <div className="tile t62" style={{ "--t-bg": "#0f766e", "--t-ink": "#f4f6f5" } as React.CSSProperties} data-reveal>
            <div className="el" data-ui style={{ fontSize: "clamp(16px, 1.7vw, 26px)", top: "12%", left: "4%", right: "4%" }}>
              <p className="wa" style={{ margin: 0, maxWidth: "26ch" }}>Kemi Adeyemi has not signed in at school today. Please contact the school if anything is wrong.</p>
            </div>
            <div className="cap"><b>The school&apos;s own wording</b><span>Every message can be edited by the school admin.</span></div>
          </div>
          <div className="tile t62 photo" style={{ "--t-bg": "#03201e", "--t-ink": "#f4f6f5" } as React.CSSProperties} data-reveal>
            <Image src="/home/public-school-children-playing-during-break-time.jpg" alt="Schoolgirls in white hijabs and green trousers playing a circle game at break time" fill sizes="(max-width: 1023px) 100vw, 50vw" style={{ objectFit: "cover", objectPosition: "center 40%" }} />
            <div className="cap"><b>Break time, then back in</b><span>Staff can tap in and out at the gate too.</span></div>
          </div>
        </div>
      </section>

      {/* Promises, printed on a card */}
      <section className="promises" aria-labelledby="promise-h">
        <div className="card" data-reveal>
          <h2 id="promise-h" className="heavy">What we promise schools</h2>
          <div className="pic">
            <Image src="/home/nigeria-students.jpg" alt="Pupils in green check uniforms in a school corridor" fill sizes="(max-width: 767px) 85vw, 50vw" />
          </div>
          <p className="names">
            Each school sees only its own pupils&nbsp;· Parents see only their own child&nbsp;· Photos only with parental
            consent&nbsp;· Two-factor login for staff&nbsp;· Records deleted after the school&apos;s retention period&nbsp;·
            Nightly backups&nbsp;· Built to the Nigeria Data Protection Act 2023&nbsp;· Your data is never sold or shared
          </p>
        </div>
      </section>

      {/* Pricing: plans that step up */}
      <section className="pricing" aria-labelledby="price-h">
        <div className="steps">
          <h2 id="price-h" className="heavy" data-reveal>Priced per pupil</h2>
          <div className="plan" style={{ "--p-bg": "#cdeee6", "--p-ink": "#03201e", "--p-strip": "#a6ddd1", "--p-strip-ink": "#03201e" } as React.CSSProperties} data-reveal>
            <div className="body">
              <h3>Pilot</h3>
              <p className="price">One term</p>
              <ul><li>One gate kiosk set up with you</li><li>Cards enrolled for every pupil</li><li>Alerts to parents</li></ul>
            </div>
            <a href="#demo" className="strip">Start a pilot</a>
          </div>
          <div className="plan" style={{ "--p-bg": "#0f766e", "--p-ink": "#f4f6f5", "--p-strip": "#0a5550", "--p-strip-ink": "#f4f6f5" } as React.CSSProperties} data-reveal>
            <div className="body">
              <h3>School</h3>
              <p className="price">Per pupil, monthly</p>
              <ul><li>Everything in the pilot</li><li>Every gate and staff attendance</li><li>Reports, ID card printing</li><li>Parent portal</li><li>Monthly invoice, by transfer</li></ul>
            </div>
            <a href="#demo" className="strip">Ask for a quote</a>
          </div>
          <div className="plan" style={{ "--p-bg": "#03201e", "--p-ink": "#f4f6f5", "--p-strip": "#e8a317", "--p-strip-ink": "#1a1204" } as React.CSSProperties} data-reveal>
            <div className="body">
              <h3>Group</h3>
              <p className="price">One invoice</p>
              <ul><li>Several campuses or schools</li><li>Each school&apos;s data kept apart</li><li>One bill for the group</li><li>Set-up visits at every site</li><li>A named person to call</li></ul>
            </div>
            <a href="#demo" className="strip">Talk to us</a>
          </div>
        </div>
      </section>

      {/* Book a demo */}
      <section id="demo" className="coupon-wrap" aria-labelledby="demo-h">
        <DemoCoupon />
      </section>

      {/* Close */}
      <footer className="close">
        <div className="top grid12">
          <div className="invite">
            <h2 className="heavy">Bring TapIn<br />to your gate.</h2>
            <a href="#demo" className="btn">Book a demo</a>
          </div>
          <nav aria-label="More">
            <Link href="/login">Staff sign in</Link>
            <Link href="/parent/login">Parents</Link>
            <Link href="/privacy">Privacy notice</Link>
            <a href="#demo">Book a demo</a>
          </nav>
        </div>
        <div className="legal">
          <p className="credits">
            Pictures:{" "}
            <a href="https://commons.wikimedia.org/wiki/File:Female_school_security_staff_watching_out_for_students.jpg">school security staff</a> by Adebukola Bassey,{" "}
            <a href="https://commons.wikimedia.org/w/index.php?curid=4416214">pupils in a corridor</a> by Dolapo Falola,{" "}
            <a href="https://commons.wikimedia.org/wiki/File:Western_Education_in_Northern_Nigeria_03.jpg">pupils lining up</a> by MicahTer,{" "}
            <a href="https://commons.wikimedia.org/w/index.php?curid=77301974">break time in Anchau, Kaduna State</a> by Benjamin Egbodo; CC BY-SA, via Wikimedia Commons.
          </p>
          <p>© 2026 TapIn</p>
        </div>
        <p className="name" aria-hidden><span className="tap">Tap</span><span className="tapin-gold gold-bright">In</span></p>
      </footer>
    </main>
  );
}
