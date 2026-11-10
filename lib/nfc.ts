/**
 * Web NFC reader + UID normalising (build plan §4, §10).
 * Web NFC works in Chrome on Android over HTTPS (or localhost). Nothing is ever written to a card.
 */

/** "04:a3:5b:1c" / "04-A3-5B-1C" / "04a35b1c" → "04A35B1C". Returns null if it isn't a plausible UID. */
export function normaliseUid(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const hex = raw.replace(/[\s:\-]/g, "").toUpperCase();
  if (!/^[0-9A-F]+$/.test(hex)) return null;
  // MIFARE UIDs are 4, 7 or 10 bytes; allow 4–10 bytes.
  if (hex.length < 8 || hex.length > 20 || hex.length % 2 !== 0) return null;
  return hex;
}

/** Last 4 characters, for showing a card without exposing its full UID. */
export function uidTail(uid: string): string {
  return uid.slice(-4);
}

/**
 * Debounce: the same UID read again within `windowMs` is the same tap.
 * Returns a function that answers "should I handle this read?".
 */
export function createTapDebouncer(windowMs = 2000, now: () => number = Date.now) {
  let lastUid: string | null = null;
  let lastAt = -Infinity;
  return (uid: string): boolean => {
    const t = now();
    if (uid === lastUid && t - lastAt < windowMs) {
      lastAt = t; // a card held still keeps re-reading; keep extending the window
      return false;
    }
    lastUid = uid;
    lastAt = t;
    return true;
  };
}

export type NfcErrorKind = "unsupported" | "insecure" | "permission_denied" | "nfc_off" | "read_failed" | "unknown";

export const NFC_ERROR_MESSAGES: Record<NfcErrorKind, string> = {
  unsupported: "This browser can't read NFC cards. Use Chrome on an Android phone, or a USB card reader.",
  insecure: "NFC only works on a secure (https) page.",
  permission_denied: "NFC permission was denied. Allow NFC for this site in Chrome settings, then try again.",
  nfc_off: "NFC is switched off. Turn on NFC in the phone's settings, then try again.",
  read_failed: "Couldn't read that card. Hold it still against the back of the phone.",
  unknown: "Something went wrong starting the NFC reader. Try again.",
};

export function nfcSupported(): boolean {
  return typeof window !== "undefined" && "NDEFReader" in window;
}

export function classifyNfcError(err: unknown): NfcErrorKind {
  if (typeof window !== "undefined" && !window.isSecureContext) return "insecure";
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError") return "permission_denied";
  if (name === "NotReadableError") return "nfc_off";
  if (name === "NotSupportedError") return "unsupported";
  return "unknown";
}

// Minimal typings for the Web NFC API (not in TypeScript's DOM lib yet).
type NDEFReadingEvent = Event & { serialNumber: string };
type NDEFReaderLike = EventTarget & {
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  onreading: ((ev: NDEFReadingEvent) => void) | null;
  onreadingerror: ((ev: Event) => void) | null;
};

/**
 * Starts listening. Calls onUid for each new (debounced) card. Returns a stop function.
 * Must be called from a user gesture (button click) the first time, for the permission prompt.
 */
export async function startNfcScan(opts: {
  onUid: (uid: string) => void;
  onError: (kind: NfcErrorKind) => void;
  debounceMs?: number;
}): Promise<() => void> {
  if (!nfcSupported()) {
    opts.onError("unsupported");
    return () => {};
  }
  const controller = new AbortController();
  const shouldHandle = createTapDebouncer(opts.debounceMs ?? 2000);
  const Reader = (window as unknown as { NDEFReader: new () => NDEFReaderLike }).NDEFReader;
  const reader = new Reader();
  reader.onreading = (ev) => {
    const uid = normaliseUid(ev.serialNumber);
    if (!uid) return opts.onError("read_failed");
    if (shouldHandle(uid)) opts.onUid(uid);
  };
  reader.onreadingerror = () => opts.onError("read_failed");
  try {
    await reader.scan({ signal: controller.signal });
  } catch (err) {
    opts.onError(classifyNfcError(err));
    return () => {};
  }
  return () => controller.abort();
}
