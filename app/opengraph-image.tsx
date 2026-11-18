import { ImageResponse } from "next/og";
import { logoSvg } from "@/components/brand/logo";

/** The picture shown when someone shares a TapIn link (WhatsApp, Facebook, X, LinkedIn). Inherited by every public page. */
export const alt = "TapIn: NFC school attendance and child safety for Nigerian schools";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  const logo = `data:image/svg+xml;base64,${Buffer.from(logoSvg("brand", 48)).toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#06201d", color: "#f4f6f5", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
          <img src={logo} width={84} height={84} />
          <span style={{ fontSize: 48, fontWeight: 800, letterSpacing: -1 }}>TapIn</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", fontSize: 72, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, maxWidth: 1000 }}>
            Every child, accounted for.
          </div>
          <div style={{ display: "flex", fontSize: 34, color: "#99d6cc", lineHeight: 1.3, maxWidth: 1000 }}>
            Students tap their card at the gate. Parents get a WhatsApp alert in seconds.
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, color: "#5EEAD4" }}>
          <span>NFC school attendance · Nigeria</span>
          <span>tapinsafe.app</span>
        </div>
      </div>
    ),
    size,
  );
}
