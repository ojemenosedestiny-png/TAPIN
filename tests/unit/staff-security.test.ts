import { describe, expect, it } from "vitest";
import { afterWrongStaffPin, newStaffPin, decodeKioskPhoto, staffPhotoPath, staffPinLocked, staffSecurityFrom, validStaffPin, weakPin, withinStaffHours, STAFF_PIN_LOCK_MS } from "@/lib/staff-security";

describe("staff check-in security", () => {
  it("reads the school's choices", () => {
    expect(staffSecurityFrom({ staff_pin_required: true, staff_photo: null, staff_alerts: true, staff_from: "06:00:00", staff_until: "18:30:00" }))
      .toEqual({ pinRequired: true, photo: false, alerts: true, from: "06:00", until: "18:30" });
  });
  it("PINs are exactly 4 digits, and obvious ones are refused", () => {
    expect(validStaffPin("0482")).toBe(true);
    for (const bad of ["482", "04821", "04a2", 4821, null]) expect(validStaffPin(bad)).toBe(false);
    expect(weakPin("1111")).toBe(true);
    expect(weakPin("1234")).toBe(true);
    expect(weakPin("0482")).toBe(false);
  });
  it("hours: inside, outside, no limit, and windows past midnight", () => {
    expect(withinStaffHours("07:15", "06:00", "18:00")).toBe(true);
    expect(withinStaffHours("05:59", "06:00", "18:00")).toBe(false);
    expect(withinStaffHours("18:01", "06:00", "18:00")).toBe(false);
    expect(withinStaffHours("03:00", null, "18:00")).toBe(true);
    expect(withinStaffHours("23:30", "22:00", "06:00")).toBe(true);
    expect(withinStaffHours("12:00", "22:00", "06:00")).toBe(false);
  });
  it("five wrong PINs lock the person for 15 minutes", () => {
    const now = new Date("2026-11-16T07:00:00Z");
    let f = 0;
    for (let i = 1; i <= 4; i++) {
      const r = afterWrongStaffPin(f, now);
      expect(r.lockedUntil).toBeNull();
      expect(r.triesLeft).toBe(5 - i);
      f = r.failures;
    }
    const locked = afterWrongStaffPin(f, now);
    expect(locked.lockedUntil).toBe(new Date(now.getTime() + STAFF_PIN_LOCK_MS).toISOString());
    expect(staffPinLocked(locked.lockedUntil, now)).toBe(true);
    expect(staffPinLocked(locked.lockedUntil, new Date(now.getTime() + STAFF_PIN_LOCK_MS + 1))).toBe(false);
  });
  it("only accepts a real, small JPEG from the kiosk", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64");
    expect(decodeKioskPhoto(`data:image/jpeg;base64,${jpeg}`)?.length).toBe(7);
    expect(decodeKioskPhoto(`data:image/png;base64,${jpeg}`)).toBeNull();
    expect(decodeKioskPhoto(`data:image/jpeg;base64,${Buffer.from("hello").toString("base64")}`)).toBeNull();
    expect(decodeKioskPhoto(`data:image/jpeg;base64,${"A".repeat(400_000)}`)).toBeNull();
  });
  it("keeps photos in the school's own folder", () => {
    expect(staffPhotoPath("sch", "2026-11-16", "st", new Date(1000))).toBe("sch/staff-taps/2026-11-16/st-1000.jpg");
  });
});

describe("newStaffPin", () => {
  it("gives 4 digits and never an easy PIN", () => {
    const seq = [1234, 7777, 42];
    expect(newStaffPin(() => seq.shift()!)).toBe("0042");
    for (let i = 0; i < 200; i++) { const p = newStaffPin(); expect(validStaffPin(p) && !weakPin(p)).toBe(true); }
  });
});
