/**
 * Reads a QR code from a live <video>. Uses the browser's own reader where it exists (Chrome on Android,
 * macOS, ChromeOS) and jsQR everywhere else (e.g. Chrome on Windows). jsQR is only downloaded when needed.
 * Browser only.
 */
type NativeDetector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type NativeCtor = (new (o: { formats: string[] }) => NativeDetector) & { getSupportedFormats?: () => Promise<string[]> };

export type QrReader = { kind: "native" | "jsqr"; read: (video: HTMLVideoElement) => Promise<string | null> };

/** Frames are scaled down to this width first: plenty for a QR held up to the camera, and fast on old laptops. */
const MAX_WIDTH = 640;

export async function createQrReader(): Promise<QrReader> {
  const Native = (globalThis as unknown as { BarcodeDetector?: NativeCtor }).BarcodeDetector;
  if (Native) {
    const formats = await Native.getSupportedFormats?.().catch(() => [] as string[]);
    if (!formats || formats.includes("qr_code")) {
      const detector = new Native({ formats: ["qr_code"] });
      return { kind: "native", read: async (v) => (await detector.detect(v).catch(() => []))[0]?.rawValue || null };
    }
  }

  const { default: jsQR } = await import("jsqr");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser can't read camera pictures.");
  return {
    kind: "jsqr",
    read: async (v) => {
      if (!v.videoWidth || !v.videoHeight) return null; // camera not ready yet
      const scale = Math.min(1, MAX_WIDTH / v.videoWidth);
      const w = Math.round(v.videoWidth * scale);
      const h = Math.round(v.videoHeight * scale);
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      ctx.drawImage(v, 0, 0, w, h);
      const found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
      return found?.data || null;
    },
  };
}
