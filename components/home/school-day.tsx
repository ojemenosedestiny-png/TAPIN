"use client";

import { useState } from "react";
import Image from "next/image";

type Stage = { name: string; time: string; body: string; bg: string; ink: string; pic?: { src: string; alt: string; w: number; h: number; pos?: string }; ui?: React.ReactNode };

const STAGES: Stage[] = [
  {
    name: "At the gate", time: "From 7:00 AM", bg: "#03201e", ink: "#f4f6f5",
    body: "The kiosk is a phone or tablet on the gate wall. Children tap their card on the way in; the gate staff see each child's photo appear and know the card is theirs.",
    pic: { src: "/home/female-school-security-staff-watching-out-for.jpg", alt: "A school security officer in uniform standing at a black metal school gate", w: 1840, h: 3264, pos: "center 12%" },
  },
  {
    name: "Greeted", time: "Every tap", bg: "#063b36", ink: "#f4f6f5",
    body: "“Good morning, Chioma, welcome to school.” A soft chime, the child's name, their class. After resumption time the screen marks the arrival as late, kindly.",
    pic: { src: "/home/nigeria-students.jpg", alt: "Pupils in green check uniforms walking along a covered school corridor", w: 1920, h: 1280 },
  },
  {
    name: "Parent told", time: "Same minute", bg: "#0a5550", ink: "#f4f6f5",
    body: "The parent's phone shows it at once, by WhatsApp or SMS, in the school's own wording. Parents can also open their child's attendance from their phone.",
    ui: <p className="wa" style={{ fontSize: 20 }}>Chioma Okafor arrived at school at 7:42 AM.<small>WhatsApp · 7:42 AM</small></p>,
  },
  {
    name: "Absence check", time: "9:00 AM", bg: "#0f766e", ink: "#f4f6f5",
    body: "Anyone who hasn't tapped in by the cutoff is listed for the class teacher, and their parents are told. Sick notes and approved leave are marked so no one is chased twice.",
    pic: { src: "/home/western-education-in-northern-nigeria-03.jpg", alt: "Pupils in blue uniforms lining up outside their classroom", w: 1920, h: 864 },
  },
  {
    name: "Home time", time: "After closing", bg: "#5fb3a7", ink: "#03201e",
    body: "A tap on the way out tells the parent their child has left. A child collected early is signed out with the reason, and the parent hears that too.",
    pic: { src: "/home/public-school-children-playing-during-break-time.jpg", alt: "Schoolgirls in white hijabs and green trousers playing a circle game in the schoolyard", w: 1920, h: 1440 },
  },
  {
    name: "The register", time: "Any day", bg: "#cdeee6", ink: "#03201e",
    body: "Today's picture at a glance, then any week or term: who is often late, who is missing days, staff attendance too. Excel or PDF in one click.",
    ui: <p style={{ font: "800 64px/1 var(--font-heading)", letterSpacing: "-0.04em", margin: 0 }}>Excel<br />PDF</p>,
  },
];

/** The school day, dark to light: one stage open, the others as slivers. */
export function SchoolDay() {
  const [open, setOpen] = useState(0);
  return (
    <div className="row" role="list">
      {STAGES.map((s, i) => {
        const isOpen = i === open;
        return (
          <div key={s.name} role="listitem" className="stage" data-open={isOpen} style={{ "--s-bg": s.bg, "--s-ink": s.ink } as React.CSSProperties}
            onClick={() => setOpen(i)}>
            <button type="button" className="tab" aria-expanded={isOpen} aria-controls={`stage-${i}`} onClick={() => setOpen(i)}>{s.name}</button>
            <div className="open" id={`stage-${i}`} aria-hidden={!isOpen}>
              <div className="words">
                <div>
                  <h3>{s.name}</h3>
                  <p className="time">{s.time}</p>
                </div>
                <p>{s.body}</p>
              </div>
              {s.pic ? (
                <div className="pic">
                  <Image src={s.pic.src} alt={s.pic.alt} fill sizes="(max-width: 1023px) 100vw, 30vw" style={{ objectFit: "cover", objectPosition: s.pic.pos ?? "center" }} />
                </div>
              ) : (
                <div className="ui" data-ui>{s.ui}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
