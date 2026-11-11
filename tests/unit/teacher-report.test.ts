import { describe, expect, it } from "vitest";
import { buildTeacherMonth, delta, monthLabel, monthRange, parseMonth, schoolDays, shiftMonth } from "@/lib/teacher-report";

describe("months", () => {
  it("parses, shifts and ranges months", () => {
    expect(parseMonth("2026-11", "x")).toBe("2026-11");
    expect(parseMonth("2026-13", "2026-01")).toBe("2026-01");
    expect(parseMonth(undefined, "2026-01")).toBe("2026-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthLabel("2026-11")).toBe("November 2026");
  });
  it("counts weekdays up to today, without holidays", () => {
    // November 2026 starts on a Sunday.
    expect(schoolDays("2026-11", "2026-11-06", new Set())).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);
    expect(schoolDays("2026-11", "2026-11-06", new Set(["2026-11-04"]))).toHaveLength(4);
    expect(schoolDays("2026-11", "2026-12-31", new Set())).toHaveLength(21);
  });
});

describe("buildTeacherMonth", () => {
  const days = ["2026-11-02", "2026-11-03", "2026-11-04"];
  const lagos = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+01:00`).toISOString();
  const report = buildTeacherMonth({
    staff: [{ id: "a", name: "Ada" }, { id: "b", name: "Bola" }, { id: "c", name: "Chidi" }],
    days, today: "2026-11-05", timeZone: "Africa/Lagos", resumptionTime: "07:45:00",
    attendance: [
      { holder_id: "a", date: "2026-11-02", sign_in_at: lagos("2026-11-02", "07:30"), sign_out_at: lagos("2026-11-02", "15:00"), auto_signed_out: false },
      { holder_id: "a", date: "2026-11-03", sign_in_at: lagos("2026-11-03", "08:00"), sign_out_at: null, auto_signed_out: false },
      { holder_id: "a", date: "2026-11-04", sign_in_at: lagos("2026-11-04", "07:40"), sign_out_at: lagos("2026-11-04", "17:00"), auto_signed_out: true },
      { holder_id: "b", date: "2026-11-02", sign_in_at: lagos("2026-11-02", "07:00"), sign_out_at: lagos("2026-11-02", "14:00"), auto_signed_out: false },
      { holder_id: "b", date: "2026-10-30", sign_in_at: lagos("2026-10-30", "07:00"), sign_out_at: null, auto_signed_out: false }, // not this month
    ],
    lessons: [
      { staff_id: "a", duration_minutes: 40, flags: [], status: "closed" },
      { staff_id: "a", duration_minutes: 10, flags: ["too_short"], status: "closed" },
      { staff_id: "b", duration_minutes: 200, flags: ["too_long", "auto_closed"], status: "auto_closed" },
      { staff_id: "b", duration_minutes: null, flags: [], status: "open" },
    ],
  });

  it("works out each teacher's month", () => {
    const ada = report.find((r) => r.staffId === "a")!;
    expect(ada).toMatchObject({ schoolDays: 3, present: 3, late: 1, avgArrival: "07:43", lessons: 2, minutes: 50, flagged: 1, missedSignOuts: 2 });
    const bola = report.find((r) => r.staffId === "b")!;
    expect(bola).toMatchObject({ present: 1, late: 0, avgArrival: "07:00", lessons: 1, minutes: 200, flagged: 1, missedSignOuts: 0 });
    const chidi = report.find((r) => r.staffId === "c")!;
    expect(chidi).toMatchObject({ present: 0, avgArrival: null, lessons: 0, minutes: 0 });
  });

  it("ranks by teaching time", () => {
    expect(report.map((r) => [r.name, r.rank])).toEqual([["Bola", 1], ["Ada", 2], ["Chidi", 3]]);
  });

  it("compares with last month", () => {
    expect(delta(10, 7)).toBe(3);
    expect(delta(10, undefined)).toBeNull();
  });
});
