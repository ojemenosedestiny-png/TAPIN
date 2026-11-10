import { describe, expect, it } from "vitest";
import { admissionFromFilename, centerSquare, cropFor } from "@/lib/image";
import { buildHeatmap } from "@/lib/heatmap";
import { deviceStatus, generateDeviceToken, hashDeviceToken, tokenMatchesHash } from "@/lib/devices";
import { pathInSchool, photoPath } from "@/lib/photos";

describe("photo crop", () => {
  it("centres the largest square", () => {
    expect(centerSquare(1200, 800)).toEqual({ x: 200, y: 0, size: 800 });
    expect(centerSquare(600, 900)).toEqual({ x: 0, y: 150, size: 600 });
  });
  it("zooms and pans but never leaves the image", () => {
    expect(cropFor(1000, 1000, 2, 0, 0)).toEqual({ x: 250, y: 250, size: 500 });
    expect(cropFor(1000, 1000, 2, -1, 1)).toEqual({ x: 0, y: 500, size: 500 });
    expect(cropFor(1000, 1000, 2, -5, 5)).toEqual({ x: 0, y: 500, size: 500 });
    expect(cropFor(1000, 1000, 0.5, 0, 0)).toEqual({ x: 0, y: 0, size: 1000 });
  });
  it("matches bulk photo files to admission numbers", () => {
    expect(admissionFromFilename("stu0012.jpg")).toBe("STU0012");
    expect(admissionFromFilename("STU/12.final.JPEG")).toBe("STU/12.FINAL");
  });
});

describe("photo paths", () => {
  it("keeps photos inside the school's folder", () => {
    const p = photoPath("school-a", "student", "s1", 123);
    expect(p).toBe("school-a/student/s1-123.jpg");
    expect(pathInSchool(p, "school-a")).toBe(true);
    expect(pathInSchool(p, "school-b")).toBe(false);
    expect(pathInSchool("school-a/../school-b/x.jpg", "school-a")).toBe(false);
  });
});

describe("device tokens", () => {
  it("are random, prefixed, and stored only as a hash", () => {
    const a = generateDeviceToken();
    const b = generateDeviceToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^tapin_dev_[A-Za-z0-9_-]{43}$/);
    const h = hashDeviceToken(a);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(a);
    expect(tokenMatchesHash(a, h)).toBe(true);
    expect(tokenMatchesHash(b, h)).toBe(false);
  });
  it("reports online / offline after 10 minutes / revoked", () => {
    const now = Date.parse("2026-11-10T08:00:00Z");
    expect(deviceStatus({ last_seen: "2026-11-10T07:55:00Z", revoked_at: null }, now)).toBe("online");
    expect(deviceStatus({ last_seen: "2026-11-10T07:49:00Z", revoked_at: null }, now)).toBe("offline");
    expect(deviceStatus({ last_seen: null, revoked_at: null }, now)).toBe("never");
    expect(deviceStatus({ last_seen: "2026-11-10T07:59:00Z", revoked_at: "2026-11-10T07:59:30Z" }, now)).toBe("revoked");
  });
});

describe("attendance heatmap", () => {
  // Wednesday 2026-11-11 in Lagos (UTC+1). Resumption 07:45.
  const base = { today: "2026-11-11", weeks: 2, resumptionTime: "07:45:00", timeZone: "Africa/Lagos" };
  it("lays out Mon–Fri columns ending this week, marking present, late, absent, holiday and future", () => {
    const cols = buildHeatmap({
      ...base,
      attendance: [
        { date: "2026-11-09", sign_in_at: "2026-11-09T06:30:00Z" }, // 07:30 local → present
        { date: "2026-11-10", sign_in_at: "2026-11-10T07:20:00Z" }, // 08:20 local → late
      ],
      holidays: ["2026-11-06"],
    });
    expect(cols).toHaveLength(2);
    expect(cols[0]!.map((c) => c.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);
    expect(cols[0]![4]!.status).toBe("holiday");
    expect(cols[0]![0]!.status).toBe("absent");
    expect(cols[1]!.map((c) => c.status)).toEqual(["present", "late", "absent", "future", "future"]);
    expect(cols[1]![1]!.time).toBe("08:20");
  });
  it("doesn't count days before the student joined as absent", () => {
    const cols = buildHeatmap({ ...base, attendance: [], holidays: [], since: "2026-11-10" });
    expect(cols[1]!.map((c) => c.status)).toEqual(["before", "absent", "absent", "future", "future"]);
  });
});
