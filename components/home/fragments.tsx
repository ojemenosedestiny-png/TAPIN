/**
 * Small, true-to-life pieces of TapIn's own screens, for the home page. Sample people and times,
 * one school morning. Each root carries data-ui: it is product interface, not decoration.
 */

type Tone = "in" | "late" | "out";
const RING: Record<Tone, string> = { in: "#16a34a", late: "#f59e0b", out: "#0284c7" };
const PILL: Record<Tone, [string, string]> = { in: ["#dcfce7", "#166534"], late: ["#fef3c7", "#92400e"], out: ["#e0f2fe", "#075985"] };

export function KioskFrag({ name, cls, time, tone = "in", place = "Main gate", greeting }: { name: string; cls: string; time: string; tone?: Tone; place?: string; greeting?: string }) {
  const initials = name.replace(/^(Mrs?|Miss|Dr)\.?\s+/, "").split(" ").map((p) => p[0]).join("").slice(0, 2);
  const [pb, pi] = PILL[tone];
  return (
    <div data-ui className="f f-kiosk">
      <div className="f-row f-muted"><span>{place}</span><span>{time}</span></div>
      <span className="f-avatar" style={{ borderColor: RING[tone] }}>{initials}</span>
      <p className="f-name">{name}</p>
      <p className="f-muted">{cls}</p>
      <p className="f-pill" style={{ background: pb, color: pi }}>{tone === "out" ? "Signed out" : tone === "late" ? "Signed in · Late" : "Signed in"}</p>
      {greeting && <p className="f-quote">&ldquo;{greeting}&rdquo;</p>}
    </div>
  );
}

export function WhatsAppFrag({ to, lines }: { to: string; lines: { text: string; time: string; warn?: boolean }[] }) {
  return (
    <div data-ui className="f f-wa">
      <div className="f-wa-top"><span className="f-wa-dot" aria-hidden />{to}</div>
      <div className="f-wa-body">
        {lines.map((l) => (
          <p key={l.text} className={l.warn ? "f-bubble warn" : "f-bubble"}>{l.text}<span>{l.time}</span></p>
        ))}
      </div>
    </div>
  );
}

export function SmsFrag({ from, text, time }: { from: string; text: string; time: string }) {
  return (
    <div data-ui className="f f-sms">
      <p className="f-row f-muted"><b>{from}</b><span>{time}</span></p>
      <p className="f-sms-text">{text}</p>
    </div>
  );
}

export function IdCardFrag({ name, no, school }: { name: string; no: string; school: string }) {
  return (
    <div data-ui className="f f-id">
      <div className="f-row"><span className="f-chip" aria-hidden /><span className="f-id-school">{school}</span></div>
      <div className="f-id-main">
        <span className="f-id-photo" aria-hidden>{name.split(" ").map((p) => p[0]).join("")}</span>
        <span><b>{name}</b><span className="f-muted">{no}</span></span>
      </div>
      <p className="f-id-foot"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M8.5 9a4 4 0 0 1 0 6" /><path d="M12 6.5a8 8 0 0 1 0 11" /><path d="M15.5 4a12 12 0 0 1 0 16" /></svg>Tap at the gate</p>
    </div>
  );
}

export function KpiFrag({ present, absent, late, staff }: { present: number; absent: number; late: number; staff: number }) {
  return (
    <div data-ui className="f f-kpi">
      <p className="f-title">Today · Main campus</p>
      <div className="f-kpi-grid">
        <span className="k in"><small>Present</small><b>{present}</b></span>
        <span className="k out"><small>Absent</small><b>{absent}</b></span>
        <span className="k late"><small>Late</small><b>{late}</b></span>
        <span className="k staff"><small>Staff in</small><b>{staff}</b></span>
      </div>
    </div>
  );
}

export function RegisterFrag({ title, rows }: { title: string; rows: { name: string; time: string; state: "In" | "Late" | "Absent" }[] }) {
  return (
    <div data-ui className="f f-reg">
      <p className="f-title">{title}</p>
      <ul>
        {rows.map((r) => (
          <li key={r.name}>
            <span className="f-ini" aria-hidden>{r.name.split(" ").map((p) => p[0]).join("")}</span>
            <span className="f-reg-name">{r.name}</span>
            <span className="f-muted">{r.time}</span>
            <span className={`f-badge ${r.state.toLowerCase()}`}>{r.state}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OfflineFrag({ saved }: { saved: number }) {
  return (
    <div data-ui className="f f-off">
      <p className="f-off-chip"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M2 2l20 20" /><path d="M8.5 16.5a5 5 0 0 1 7 0" /><path d="M5 12.9a10 10 0 0 1 5.2-2.8" /><path d="M19 12.9a10 10 0 0 0-2.2-1.6" /><path d="M2 8.8a15 15 0 0 1 4.2-2.6" /><path d="M22 8.8a15 15 0 0 0-11.3-3.8" /><circle cx="12" cy="20" r="1" /></svg>Offline · taps saved ({saved})</p>
      <p className="f-off-line">Sends by itself when the network returns.</p>
    </div>
  );
}

export function PickupFrag({ person, relation, kids, time }: { person: string; relation: string; kids: string[]; time: string }) {
  return (
    <div data-ui className="f f-pick">
      <div className="f-pick-head">
        <span className="f-ini lg" aria-hidden>{person.split(" ").map((p) => p[0]).join("")}</span>
        <span><b>{person}</b><span className="f-muted">{relation} · approved</span></span>
      </div>
      <p className="f-muted">May collect</p>
      <p className="f-pick-kids">{kids.map((k) => <span key={k}>{k}</span>)}</p>
      <p className="f-pick-btn">Confirm pickup · {time}</p>
    </div>
  );
}

export function RollFrag({ safe, total }: { safe: number; total: number }) {
  return (
    <div data-ui className="f f-roll">
      <p className="f-title">Fire drill · roll call</p>
      <p className="f-roll-num"><b>{safe}</b> of {total} safe</p>
      <span className="f-bar" aria-hidden><span style={{ width: `${Math.round((safe / total) * 100)}%` }} /></span>
      <p className="f-muted">{total - safe} still to find · JSS 1B, SS 2A</p>
    </div>
  );
}

export function LessonFrag({ teacher, subject, cls, minutes }: { teacher: string; subject: string; cls: string; minutes: number }) {
  return (
    <div data-ui className="f f-lesson">
      <p className="f-row"><b>{teacher}</b><span className="f-live">Teaching</span></p>
      <p className="f-muted">{subject} · {cls}</p>
      <p className="f-lesson-min"><b>{minutes}</b> min so far</p>
    </div>
  );
}
