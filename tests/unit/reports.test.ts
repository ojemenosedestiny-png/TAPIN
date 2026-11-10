import { describe, expect, it } from "vitest";
import { attendanceRate, fetchAllPages, formatRate, parseRange, presetRanges, totals } from "@/lib/reports";

describe("attendance rate", () => {
  it("counts on-time and late as attended, and ignores excused days", () => {
    expect(attendanceRate({ school_days: 10, present: 7, late: 1, excused: 0 })).toBe(80);
    expect(attendanceRate({ school_days: 10, present: 7, late: 1, excused: 2 })).toBe(100);
    expect(attendanceRate({ school_days: 3, present: 1, late: 0, excused: 0 })).toBe(33.3);
  });
  it("is empty when nothing counts", () => {
    expect(attendanceRate({ school_days: 0, present: 0, late: 0, excused: 0 })).toBeNull();
    expect(attendanceRate({ school_days: 2, present: 0, late: 0, excused: 2 })).toBeNull();
    expect(formatRate(null)).toBe("—");
    expect(formatRate(92.5)).toBe("92.5%");
  });
  it("adds up a class", () => {
    const t = totals([
      { student_id: "a", class_id: "c", school_days: 5, present: 5, late: 0, absent: 0, excused: 0 },
      { student_id: "b", class_id: "c", school_days: 5, present: 2, late: 1, absent: 2, excused: 0 },
    ]);
    expect(t).toMatchObject({ school_days: 10, present: 7, late: 1, absent: 2, rate: 80 });
  });
});

describe("report date range", () => {
  const today = "2026-11-11"; // Wednesday
  it("defaults to this week", () => {
    expect(parseRange(undefined, undefined, today)).toEqual({ from: "2026-11-09", to: "2026-11-11" });
  });
  it("swaps a reversed range and ignores junk", () => {
    expect(parseRange("2026-11-11", "2026-11-01", today)).toMatchObject({ from: "2026-11-01", to: "2026-11-11", error: expect.any(String) });
    expect(parseRange("yesterday", "'; drop", today)).toEqual({ from: "2026-11-09", to: "2026-11-11" });
  });
  it("caps very long ranges", () => {
    const r = parseRange("2024-01-01", "2026-11-11", today);
    expect(r.error).toMatch(/at most 200 days/);
    expect((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000).toBe(200);
  });
  it("offers useful presets", () => {
    const p = Object.fromEntries(presetRanges(today).map((x) => [x.label, [x.from, x.to]]));
    expect(p["This week"]).toEqual(["2026-11-09", "2026-11-11"]);
    expect(p["Last week"]).toEqual(["2026-11-02", "2026-11-06"]);
    expect(p["This month"]).toEqual(["2026-11-01", "2026-11-11"]);
  });
});

describe("paging past Supabase's 1,000-row limit", () => {
  it("keeps fetching until a short page", async () => {
    const all = Array.from({ length: 2500 }, (_, i) => i);
    const calls: [number, number][] = [];
    const rows = await fetchAllPages(async (from, to) => {
      calls.push([from, to]);
      return { data: all.slice(from, to + 1), error: null };
    });
    expect(rows).toHaveLength(2500);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it("surfaces errors", async () => {
    await expect(fetchAllPages(async () => ({ data: null, error: { message: "boom" } }))).rejects.toThrow("boom");
  });
});
