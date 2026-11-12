import { describe, expect, it } from "vitest";
import { childState, hashPickupCode, hashQrToken, joinNames, newPickupCode, newQrToken, normalisePickupCode, notAuthorisedMessage, parsePickupQr, pickupMessage } from "@/lib/pickup";

describe("pickup codes", () => {
  it("accepts six digits, with spaces or dashes", () => {
    expect(normalisePickupCode("123456")).toBe("123456");
    expect(normalisePickupCode("123 456")).toBe("123456");
    expect(normalisePickupCode("123-456")).toBe("123456");
    expect(normalisePickupCode("12345")).toBeNull();
    expect(normalisePickupCode("12345a")).toBeNull();
    expect(normalisePickupCode(123456)).toBeNull();
  });
  it("makes six-digit codes and hashes them per school", () => {
    for (let i = 0; i < 50; i++) expect(newPickupCode()).toMatch(/^\d{6}$/);
    expect(hashPickupCode("a", "123456")).not.toBe(hashPickupCode("b", "123456"));
    expect(hashPickupCode("a", "123456")).toBe(hashPickupCode("a", "123456"));
  });
});

describe("pickup QR codes", () => {
  it("reads passes and one-day codes, and nothing else", () => {
    const token = newQrToken();
    expect(parsePickupQr(`TAPIN-P:${token}`)).toEqual({ kind: "pass", token });
    expect(parsePickupQr("TAPIN-C:482915")).toEqual({ kind: "code", code: "482915" });
    expect(parsePickupQr("TAPIN-C:4829")).toBeNull();
    expect(parsePickupQr("TAPIN-P:short")).toBeNull();
    expect(parsePickupQr("https://example.com")).toBeNull();
    expect(parsePickupQr(42)).toBeNull();
    expect(hashQrToken(token)).not.toContain(token);
  });
});

describe("pickup", () => {
  it("knows whether a child can be collected", () => {
    expect(childState(undefined)).toBe("not_in");
    expect(childState({ sign_in_at: "x", sign_out_at: null })).toBe("in_school");
    expect(childState({ sign_in_at: "x", sign_out_at: "y" })).toBe("signed_out");
  });
  it("joins names the way people say them", () => {
    expect(joinNames(["Ada"])).toBe("Ada");
    expect(joinNames(["Ada", "Tolu"])).toBe("Ada and Tolu");
    expect(joinNames(["Ada", "Tolu", "Femi"])).toBe("Ada, Tolu and Femi");
  });
  it("writes the parent messages", () => {
    expect(pickupMessage({ child: "Ada Obi", picker: "Ngozi Obi", relationship: "Aunt", time: "2:15 PM", school: "Bright Stars" }))
      .toBe("Ada Obi was picked up by Ngozi Obi (aunt) at 2:15 PM. Bright Stars.");
    expect(pickupMessage({ child: "Ada Obi", picker: "Mr Bello", time: "2:15 PM", school: "Bright Stars" }))
      .toBe("Ada Obi was picked up by Mr Bello at 2:15 PM. Bright Stars.");
    expect(notAuthorisedMessage({ picker: "Mr Bello", time: "2:15 PM", school: "Bright Stars" })).toContain("not authorised");
  });
});
