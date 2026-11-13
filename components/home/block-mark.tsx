/** The footer's close: "TapIn" built from five blocks of stepped height, each letter cut out of its own block. */
const LETTERS = [
  { ch: "T", h: 0.86, fill: "var(--h-teal)" },
  { ch: "a", h: 0.64, fill: "var(--h-gold)" },
  { ch: "p", h: 0.78, fill: "var(--h-bm-p)" },
  { ch: "I", h: 1, fill: "var(--h-mint)" },
  { ch: "n", h: 0.7, fill: "var(--h-teal-2)" },
];

export function BlockMark() {
  const W = 1000, H = 300, gap = 6;
  const w = (W - gap * (LETTERS.length - 1)) / LETTERS.length;
  return (
    <svg className="block-mark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="TapIn" preserveAspectRatio="xMidYMax meet">
      {LETTERS.map((l, i) => {
        const h = H * l.h;
        const x = i * (w + gap);
        return (
          <g key={l.ch} className="bm-block" style={{ "--i": i } as React.CSSProperties}>
            <rect x={x} y={H - h} width={w} height={h} rx={10} fill={l.fill} />
            <text x={x + w / 2} y={H - 28} textAnchor="middle" className="bm-letter">{l.ch}</text>
          </g>
        );
      })}
    </svg>
  );
}
