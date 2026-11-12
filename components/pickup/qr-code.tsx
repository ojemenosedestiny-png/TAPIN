import qrcode from "qrcode-generator";

/** A QR code drawn as one SVG path (sharp at any size, prints well). */
export function QrCode({ value, size = 220, label }: { value: string; size?: number; label: string }) {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  const box = n + quiet * 2;
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${box} ${box}`} shapeRendering="crispEdges" className="rounded-lg bg-white">
      <rect width={box} height={box} fill="#fff" />
      <path d={d} fill="#0b1f1e" />
    </svg>
  );
}
