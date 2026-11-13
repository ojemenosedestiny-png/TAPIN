"use client";

import { useId, useState } from "react";
import { BookDemo } from "@/components/site/book-demo";

const CLASSES = ["JSS 1A", "JSS 2A", "JSS 3B", "SS 1A", "SS 2B", "SS 3A"];
const LATE_AFTER = [["07:45", "7:45 AM"], ["08:00", "8:00 AM"], ["08:15", "8:15 AM"]] as const;
const SCHOOL = "Bright Stars College";

/** 6:30 → 390 minutes after midnight. */
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
function clock(min: number): string {
  const h = Math.floor(min / 60);
  const m = String(min % 60).padStart(2, "0");
  return `${((h + 11) % 12) + 1}:${m} ${h < 12 ? "AM" : "PM"}`;
}
const greetingFor = (min: number) => (min < 12 * 60 ? "Good morning" : min < 17 * 60 ? "Good afternoon" : "Good evening");

/**
 * The live thing: set a child and a time, and see the kiosk screen and the parent's message exactly as TapIn
 * writes them. Server-rendered with sensible defaults, so it reads fine before (or without) JavaScript.
 */
export function GateDemo() {
  const id = useId();
  const [name, setName] = useState("Chioma Okafor");
  const [cls, setCls] = useState("JSS 2A");
  const [arrive, setArrive] = useState(7 * 60 + 42);
  const [lateAfter, setLateAfter] = useState<string>("08:00");
  const [channel, setChannel] = useState<"whatsapp" | "sms">("whatsapp");
  const [online, setOnline] = useState(true);
  const [leaving, setLeaving] = useState(false);

  const full = name.trim() || "Your child";
  const first = full.split(/\s+/)[0]!;
  const initials = full.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const at = leaving ? 14 * 60 + 10 : arrive;
  const time = clock(at);
  const late = !leaving && arrive > toMinutes(lateAfter);
  const tone = leaving ? "out" : late ? "late" : "in";
  const status = leaving ? "Signed out" : late ? "Signed in · Late" : "Signed in";
  const quote = leaving ? `Goodbye, ${first}. See you tomorrow.` : `${greetingFor(at)}, ${first}. Welcome to school.`;
  const message = leaving
    ? `${SCHOOL}: ${full} left school at ${time}.`
    : late ? `${SCHOOL}: ${full} arrived late at ${time}. The school day starts at ${clock(toMinutes(lateAfter))}.`
    : `${SCHOOL}: ${full} arrived at school at ${time}.`;

  return (
    <div className="demo-panel shutter" data-reveal>
      <div className="demo-stage" aria-live="polite">
        <div data-ui className={`demo-kiosk tone-${tone}`}>
          <div className="f-row f-muted"><span>Main gate</span><span>{time}</span></div>
          <span className="demo-avatar">{initials}</span>
          <p className="demo-name">{full}</p>
          <p className="f-muted">{cls}</p>
          <p className="demo-pill">{status}</p>
          <p className="demo-quote">&ldquo;{quote}&rdquo;</p>
          {!online && <p className="demo-saved">No internet · tap saved on the kiosk</p>}
        </div>
        <div data-ui className={`demo-phone ${channel}`}>
          <p className="demo-phone-top">{channel === "whatsapp" ? "WhatsApp" : "Messages"} · {first}&apos;s parent</p>
          {online ? (
            <p className={`demo-msg${late ? " warn" : ""}`}>{message}<span>{time}</span></p>
          ) : (
            <p className="demo-wait">Waiting for the gate to reconnect. The message goes out on its own, with the real time.</p>
          )}
        </div>
      </div>

      <div className="demo-controls">
        <label className="ctl" htmlFor={`${id}-name`}>
          <span>Child&apos;s name</span>
          <input id={`${id}-name`} value={name} maxLength={28} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </label>
        <label className="ctl" htmlFor={`${id}-cls`}>
          <span>Class</span>
          <select id={`${id}-cls`} value={cls} onChange={(e) => setCls(e.target.value)}>{CLASSES.map((c) => <option key={c}>{c}</option>)}</select>
        </label>
        <label className="ctl ctl-range" htmlFor={`${id}-time`}>
          <span>Arrives at <b>{clock(arrive)}</b></span>
          <input id={`${id}-time`} type="range" min={6 * 60 + 30} max={9 * 60 + 30} step={1} value={arrive} disabled={leaving}
            onChange={(e) => setArrive(Number(e.target.value))} aria-valuetext={clock(arrive)} />
        </label>
        <label className="ctl" htmlFor={`${id}-late`}>
          <span>Late after</span>
          <select id={`${id}-late`} value={lateAfter} onChange={(e) => setLateAfter(e.target.value)}>{LATE_AFTER.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <div className="ctl" role="radiogroup" aria-label="Parent gets">
          <span>Parent gets</span>
          <span className="seg">
            {(["whatsapp", "sms"] as const).map((c) => (
              <button key={c} type="button" role="radio" aria-checked={channel === c} onClick={() => setChannel(c)}>{c === "whatsapp" ? "WhatsApp" : "SMS"}</button>
            ))}
          </span>
        </div>
        <div className="ctl">
          <span id={`${id}-net`}>Gate internet</span>
          <button type="button" role="switch" aria-checked={online} aria-labelledby={`${id}-net`} className="sw" onClick={() => setOnline((v) => !v)}><span /></button>
        </div>
        <div className="ctl">
          <span id={`${id}-out`}>Going home</span>
          <button type="button" role="switch" aria-checked={leaving} aria-labelledby={`${id}-out`} className="sw" onClick={() => setLeaving((v) => !v)}><span /></button>
        </div>
        <div className="demo-foot"><BookDemo label="See it at your school" className="btn btn-gold" /></div>
      </div>
    </div>
  );
}
