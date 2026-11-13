/**
 * "Many into one": children arriving in a crowd (scattered squares), passing the kiosk in single file
 * (a tight ribbon), and landing in ordered class registers (rows in the accent colour).
 * Positions come from a fixed seed, so server and browser draw the same picture.
 */
type Sq = { x: number; y: number; zone: 0 | 1 | 2; pale?: boolean };

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function squares(): Sq[] {
  const r = seeded(7_42);
  const out: Sq[] = [];
  // The crowd at the gate: loose, two pale tones.
  for (let i = 0; i < 40; i++) out.push({ x: 20 + r() * 400, y: 24 + r() * 260, zone: 0, pale: r() > 0.5 });
  // The kiosk: one ribbon, three squares high.
  for (let c = 0; c < 22; c++) for (let row = 0; row < 3; row++) out.push({ x: 488 + c * 21, y: 138 + row * 16, zone: 1 });
  // The registers: four classes in tidy rows.
  for (let row = 0; row < 4; row++) for (let c = 0; c < 9; c++) out.push({ x: 1000 + c * 48, y: 52 + row * 64, zone: 2 });
  return out;
}

const ALL = squares();

function Diagram({ vertical }: { vertical?: boolean }) {
  const size = vertical ? 9 : 12;
  // The phone turns the diagram to run top to bottom (3:4).
  const place = (s: Sq) => (vertical ? { x: (s.y / 310) * 300, y: (s.x / 1440) * 400 } : { x: s.x, y: s.y });
  return (
    <svg className={vertical ? "flow-svg v" : "flow-svg h"} viewBox={vertical ? "0 0 300 400" : "0 0 1440 320"} role="img"
      aria-label="Children arriving in a crowd, passing the kiosk one at a time, and filling their class registers in order">
      {ALL.map((s, i) => {
        const p = place(s);
        const order = vertical ? p.y / 400 : p.x / 1440;
        return (
          <rect key={i} x={p.x} y={p.y} width={size} height={size} rx={2}
            className={s.zone === 2 ? "sq reg" : s.zone === 1 ? "sq kiosk" : s.pale ? "sq crowd pale" : "sq crowd"}
            style={{ "--o": order.toFixed(3) } as React.CSSProperties} />
        );
      })}
    </svg>
  );
}

export function GateFlow() {
  const steps = [
    ["Arrive", "Children come through the gate from 6:30, in no particular order."],
    ["Tap", "One tap each. The kiosk shows the photo and says good morning by name."],
    ["Recorded", "Every class register fills itself, and each parent is told the time."],
  ];
  return (
    <div className="flow" data-reveal>
      <Diagram />
      <Diagram vertical />
      <ol className="flow-steps">
        {steps.map(([t, b]) => (
          <li key={t}><b>{t}</b><span>{b}</span></li>
        ))}
      </ol>
    </div>
  );
}
