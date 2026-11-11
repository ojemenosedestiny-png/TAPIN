import { describe, expect, it } from "vitest";
import { checkPin, duration, groupRoll, hashPin, rollCounts, validPin, type RollPerson } from "@/lib/emergency";
import { planAllows } from "@/lib/plans";

describe("plans", () => {
  it("locks Premium features on Basic", () => {
    expect(planAllows("basic", "emergency")).toBe(false);
    expect(planAllows("premium", "emergency")).toBe(true);
    expect(planAllows("basic", "pickup")).toBe(true);
    expect(planAllows("basic", "lessons")).toBe(true);
  });
});

describe("emergency PIN", () => {
  it("accepts 4 to 6 digits and checks against the stored hash", () => {
    expect(validPin("1234")).toBe(true);
    expect(validPin("123")).toBe(false);
    expect(validPin("1234567")).toBe(false);
    expect(validPin("12a4")).toBe(false);
    const stored = hashPin("4821");
    expect(stored).not.toContain("4821");
    expect(checkPin("4821", stored)).toBe(true);
    expect(checkPin("4822", stored)).toBe(false);
    expect(checkPin("4821", null)).toBe(false);
    expect(hashPin("4821")).not.toBe(stored); // salted
  });
});

describe("roll", () => {
  const p = (name: string, group: string, safe: boolean): RollPerson => ({
    id: name, holder_type: group === "Staff" ? "staff" : "student", holder_id: name, name, group_name: group, on_roster: true, safe_at: safe ? "2026-11-12T10:00:00Z" : null, marked_by: null,
  });
  it("counts safe and missing", () => {
    expect(rollCounts([p("A", "JSS1", true), p("B", "JSS1", false)])).toEqual({ total: 2, safe: 1, missing: 1 });
  });
  it("groups classes in order, staff last, missing first", () => {
    const g = groupRoll([p("Zed", "Staff", false), p("Ada", "JSS10", true), p("Bola", "JSS2", true), p("Chi", "JSS2", false)]);
    expect(g.map((x) => x.name)).toEqual(["JSS2", "JSS10", "Staff"]);
    expect(g[0]!.people.map((x) => x.name)).toEqual(["Chi", "Bola"]);
    expect(g[0]).toMatchObject({ safe: 1, total: 2 });
  });
  it("formats how long it took", () => {
    expect(duration("2026-11-12T10:00:00Z", "2026-11-12T10:12:30Z")).toBe("13 min");
    expect(duration("2026-11-12T10:00:00Z", "2026-11-12T11:05:00Z")).toBe("1h 05m");
  });
});
