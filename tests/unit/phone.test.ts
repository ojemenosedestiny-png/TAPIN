import { describe, expect, it } from "vitest";
import { formatNgPhone, normaliseNgPhone } from "@/lib/phone";

describe("Nigerian phone numbers", () => {
  it("normalises every common way of writing a mobile number to +234", () => {
    for (const v of ["08031234567", "8031234567", "2348031234567", "+2348031234567", "+234 803 123 4567", "0803-123-4567", "(0803) 123 4567"]) {
      expect(normaliseNgPhone(v)).toBe("+2348031234567");
    }
    expect(normaliseNgPhone("07061234567")).toBe("+2347061234567");
    expect(normaliseNgPhone("09121234567")).toBe("+2349121234567");
  });
  it("rejects numbers that can't be Nigerian mobiles", () => {
    for (const v of ["", null, "12345", "0803123456", "080312345678", "+447911123456", "01234567890", "abc", "080+31234567"]) {
      expect(normaliseNgPhone(v)).toBeNull();
    }
  });
  it("formats for display", () => {
    expect(formatNgPhone("+2348031234567")).toBe("0803 123 4567");
    expect(formatNgPhone("weird")).toBe("weird");
  });
});
