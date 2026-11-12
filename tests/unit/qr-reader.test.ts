import { describe, expect, it } from "vitest";
import qrcode from "qrcode-generator";
import jsQR from "jsqr";
import { QR_PASS_PREFIX, newQrToken, parsePickupQr } from "@/lib/pickup";

/** Draws a QR exactly as the app makes it (qrcode-generator, level M) into RGBA pixels, like a camera frame. */
function frame(text: string, cell = 6, quiet = 4, noise = 0) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = (n + quiet * 2) * cell;
  const px = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / cell) - quiet;
      const my = Math.floor(y / cell) - quiet;
      const dark = mx >= 0 && my >= 0 && mx < n && my < n && qr.isDark(my, mx);
      const v = Math.max(0, Math.min(255, (dark ? 20 : 235) + Math.round((Math.random() - 0.5) * noise)));
      const i = (y * size + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = v;
      px[i + 3] = 255;
    }
  }
  return { px, size };
}

describe("kiosk QR reading with jsQR (Windows laptops)", () => {
  it("reads a parent's pickup QR pass and the kiosk recognises it", () => {
    const text = `${QR_PASS_PREFIX}${newQrToken()}`;
    const { px, size } = frame(text);
    const found = jsQR(px, size, size, { inversionAttempts: "dontInvert" });
    expect(found?.data).toBe(text);
    expect(parsePickupQr(found!.data)).not.toBeNull();
  });

  it("still reads it through camera-like noise", () => {
    const text = `${QR_PASS_PREFIX}${newQrToken()}`;
    const { px, size } = frame(text, 5, 4, 60);
    expect(jsQR(px, size, size, { inversionAttempts: "dontInvert" })?.data).toBe(text);
  });

  it("finds nothing in a blank frame", () => {
    const size = 200;
    const px = new Uint8ClampedArray(size * size * 4).fill(230);
    expect(jsQR(px, size, size)).toBeNull();
  });
});
