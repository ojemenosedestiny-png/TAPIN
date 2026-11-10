import { ImageResponse } from "next/og";
import { logoSvg } from "@/components/brand/logo";

/**
 * PNG of the TapIn mark at any size. `maskable` adds safe-zone padding on a teal
 * background so Android can crop it into a circle or squircle without cutting the T.
 */
export function brandIcon(size: number, { maskable = false }: { maskable?: boolean } = {}) {
  const src = `data:image/svg+xml;base64,${Buffer.from(logoSvg("brand", 48)).toString("base64")}`;
  const inner = maskable ? Math.round(size * 0.8) : size;
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: maskable ? "#0F766E" : "transparent" }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={src} width={inner} height={inner} />
      </div>
    ),
    { width: size, height: size },
  );
}
