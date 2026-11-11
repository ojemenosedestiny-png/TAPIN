"use client";

import { useState } from "react";
import { Volume2 } from "lucide-react";
import { greetingForHour, speak, spokenGreeting } from "@/lib/greeting";
import { play, soundLengthMs, unlockAudio } from "@/lib/sound";
import { initials } from "@/components/dashboard/person-avatar";

const clean = (v: string) => v.replace(/[^\p{L}\p{M}' -]/gu, "").replace(/\s+/g, " ").slice(0, 24);

/**
 * The showcase and the page's one live thing: type a child's first name and see what the gate shows and what
 * the parent receives, then hear the greeting. Same words, chime and voice rules as the real kiosk.
 */
export function Showcase() {
  const [name, setName] = useState("Chioma");
  const full = clean(name).trim() || "Chioma";
  const first = full.split(" ")[0]!;

  const hear = () => {
    unlockAudio();
    play("signIn");
    speak(spokenGreeting("signed_in", first, 8), { delayMs: soundLengthMs("signIn") });
  };

  return (
    <section className="showcase" aria-labelledby="showcase-h">
      <div className="wrap">
        <h2 id="showcase-h" className="stack heavy">
          <span className="l1" data-reveal>Tap at 7:42.</span>
          <span className="l2" data-reveal style={{ "--i": 1 } as React.CSSProperties}>Greeted by name.</span>
        </h2>

        <div className="facts grid12">
        <div className="object" data-reveal style={{ "--i": 2 } as React.CSSProperties}>
          <div className="kiosk-shot" data-ui role="img" aria-label={`The gate kiosk greeting ${full}`}>
            <div className="portrait" aria-hidden>{initials(full)}</div>
            <div className="min-w-0">
              <div className="hello">{greetingForHour(8)},</div>
              <div className="name">{full}</div>
              <div className="chips"><span className="chip">JSS2A</span><span className="chip">ADM 0142</span></div>
              <div className="status">Signed in · 7:42 AM</div>
            </div>
            <div className="drain" aria-hidden><span /></div>
          </div>
        </div>

          <div className="facts-col">
            <p data-reveal>
              Each child taps a TapIn card on the kiosk at the gate. Their photo fills the screen, so the guard can see the
              card is theirs, and the kiosk greets them by name in a calm, recorded voice.
            </p>
            <p data-reveal style={{ "--i": 1 } as React.CSSProperties}>
              Within the same minute the parent gets a WhatsApp or SMS. If the internet drops, the kiosk keeps every tap and
              sends it the moment it is back.
            </p>
            <div className="live" data-reveal style={{ "--i": 2 } as React.CSSProperties}>
              <label htmlFor="child-name">Try it with your child&apos;s name</label>
              <div className="row">
                <input id="child-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" spellCheck={false} maxLength={24} />
                <button type="button" className="btn hear" onClick={hear} aria-label={`Hear the greeting for ${first}`}>
                  <Volume2 className="size-5" aria-hidden /> Hear it
                </button>
              </div>
              <p className="wa" aria-live="polite">
                {full} arrived at school at 7:42 AM.
                <small>WhatsApp to the parent · 7:42 AM</small>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
