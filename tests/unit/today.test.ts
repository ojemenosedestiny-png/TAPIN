import { describe, expect, it } from "vitest";
import { bucketArrivals, niceTicks } from "@/lib/today";

describe("the morning gate (arrivals chart)", () => {
  it("shows the hour before resumption and half an hour after, in 10-minute slots", () => {
    const b = bucketArrivals([], "07:45:00");
    expect(b[0]!.start).toBe("06:45");
    expect(b.at(-1)!.end).toBe("08:15");
    expect(b.every((x) => x.count === 0)).toBe(true);
  });

  it("counts each arrival once and marks slots from resumption on as late", () => {
    const b = bucketArrivals(["07:01", "07:05", "07:44", "07:45", "08:02"], "07:45");
    expect(b.reduce((a, x) => a + x.count, 0)).toBe(5);
    expect(b.find((x) => x.start === "06:55")!.count).toBe(2); // 07:01 and 07:05
    // 07:45 is on time by the tap rule (late is AFTER resumption): same slot as 07:44
    expect(b.find((x) => x.end === "07:45")).toMatchObject({ count: 2, late: false });
    expect(b.find((x) => x.start === "07:45")).toMatchObject({ count: 0, late: true });
    expect(b.find((x) => x.start === "07:55")).toMatchObject({ count: 1, late: true }); // 08:02
  });

  it("widens to include early birds and very late arrivals, never more than 24 bars", () => {
    const b = bucketArrivals(["05:30", "11:15"], "07:45");
    expect(b.length).toBeLessThanOrEqual(24);
    expect(b[0]!.start <= "05:30").toBe(true);
    expect(b.at(-1)!.end > "11:15").toBe(true);
    expect(b.reduce((a, x) => a + x.count, 0)).toBe(2);
  });
});

describe("chart axis", () => {
  it("uses round steps with the top tick above the maximum", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(8)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(37)).toEqual([0, 10, 20, 30, 40]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3, 4]);
  });
});
