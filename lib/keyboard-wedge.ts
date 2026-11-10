import { normaliseUid } from "@/lib/nfc";

/**
 * USB "keyboard wedge" card readers type the UID very fast and press Enter.
 * This tells them apart from a person typing: keys must arrive less than `maxGapMs` apart.
 */
// 120 ms: readers type at ~5–20 ms per key, but a busy, cheap tablet can delay key events.
// People type 150 ms+ per key, so typing by hand still doesn't count as a tap.
export function createWedgeReader(onUid: (uid: string) => void, { maxGapMs = 120 }: { maxGapMs?: number } = {}) {
  let buffer = "";
  let lastAt = 0;
  return (key: string, at: number): boolean => {
    if (at - lastAt > maxGapMs) buffer = "";
    lastAt = at;
    if (key === "Enter") {
      const uid = normaliseUid(buffer);
      buffer = "";
      if (uid) {
        onUid(uid);
        return true;
      }
      return false;
    }
    if (key.length === 1 && /[0-9a-fA-F:\-]/.test(key)) buffer += key;
    else buffer = "";
    return false;
  };
}
