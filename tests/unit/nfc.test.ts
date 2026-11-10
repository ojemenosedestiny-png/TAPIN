import { describe, expect, it } from "vitest";
import { createTapDebouncer, normaliseUid, uidTail } from "@/lib/nfc";

describe("normaliseUid", () => {
  it("normalises Web NFC serial numbers to uppercase hex with no colons", () => {
    expect(normaliseUid("04:a3:5b:1c")).toBe("04A35B1C");
    expect(normaliseUid("04-A3-5B-1C")).toBe("04A35B1C");
    expect(normaliseUid(" 04a35b1c ")).toBe("04A35B1C");
    expect(normaliseUid("04:a3:5b:1c:22:80:90")).toBe("04A35B1C228090"); // 7-byte UID
  });
  it("rejects things that aren't UIDs", () => {
    for (const bad of ["", null, undefined, "hello", "04A35B", "04A35B1", "04:a3:5b:1c:zz", "0".repeat(22), "04A3 5B1C'; drop"]) {
      expect(normaliseUid(bad)).toBeNull();
    }
  });
  it("shows only the last 4 characters", () => {
    expect(uidTail("04A35B1C")).toBe("5B1C");
  });
});

describe("tap debouncer", () => {
  it("treats the same UID within 2 seconds as one tap", () => {
    let t = 0;
    const should = createTapDebouncer(2000, () => t);
    expect(should("AAAAAAAA")).toBe(true);
    t = 500;
    expect(should("AAAAAAAA")).toBe(false);
    t = 2600; // 2.1 s after the last read (the window extends while the card is held)
    expect(should("AAAAAAAA")).toBe(true);
  });
  it("keeps extending while a card is held against the reader", () => {
    let t = 0;
    const should = createTapDebouncer(2000, () => t);
    should("AAAAAAAA");
    for (t = 1000; t <= 6000; t += 1000) expect(should("AAAAAAAA")).toBe(false);
  });
  it("lets a different card through immediately", () => {
    let t = 0;
    const should = createTapDebouncer(2000, () => t);
    expect(should("AAAAAAAA")).toBe(true);
    t = 100;
    expect(should("BBBBBBBB")).toBe(true);
    t = 200;
    expect(should("AAAAAAAA")).toBe(true);
  });
});
