import { describe, expect, it } from "vitest";
import { areaForPath, canAccess, homePath, isRole } from "@/lib/auth/roles";

describe("role access", () => {
  it("super admin manages the platform but has no routine access to student records", () => {
    expect(canAccess("super_admin", "platform")).toBe(true);
    for (const area of ["students", "cards", "today", "reports", "devices", "enroll"] as const) {
      expect(canAccess("super_admin", area)).toBe(false);
    }
  });

  it("school admin manages everything in their school but not the platform", () => {
    for (const area of ["today", "students", "staff", "classes", "cards", "devices", "alerts", "reports", "settings", "enroll"] as const) {
      expect(canAccess("school_admin", area)).toBe(true);
    }
    expect(canAccess("school_admin", "platform")).toBe(false);
  });

  it("teacher only sees attendance areas", () => {
    expect(canAccess("teacher", "today")).toBe(true);
    expect(canAccess("teacher", "students")).toBe(true);
    for (const area of ["cards", "devices", "alerts", "settings", "enroll", "staff", "classes", "platform"] as const) {
      expect(canAccess("teacher", area)).toBe(false);
    }
  });

  it("lessons are for school admins; teachers see only their own report", () => {
    expect(canAccess("school_admin", "lessons")).toBe(true);
    expect(canAccess("teacher", "lessons")).toBe(false);
    expect(canAccess("teacher", "my-report")).toBe(true);
    expect(canAccess("super_admin", "lessons")).toBe(false);
    expect(areaForPath("/lessons/monthly")).toBe("lessons");
    expect(areaForPath("/my-report")).toBe("my-report");
    expect(areaForPath("/r/abc")).toBeNull();
  });

  it("sends each role to its home page", () => {
    expect(homePath("super_admin")).toBe("/platform");
    expect(homePath("school_admin")).toBe("/today");
    expect(homePath("teacher")).toBe("/today");
  });

  it("maps paths to areas", () => {
    expect(areaForPath("/students/123")).toBe("students");
    expect(areaForPath("/platform")).toBe("platform");
    expect(areaForPath("/login")).toBeNull();
    expect(areaForPath("/kiosk")).toBeNull();
    expect(areaForPath("/")).toBeNull();
  });

  it("validates role strings", () => {
    expect(isRole("teacher")).toBe(true);
    expect(isRole("guardian")).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});
