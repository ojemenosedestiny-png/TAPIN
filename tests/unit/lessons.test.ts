import { describe, expect, it } from "vitest";
import { decideStaffTap, directorLessonMessage, directorWantsLesson, formatMinutes, lessonFlags, minutesBetween } from "@/lib/lessons";

const at = (iso: string) => new Date(iso);
const base = { now: at("2026-11-16T09:00:00Z"), tappedAt: at("2026-11-16T09:00:00Z"), lastTapAt: null, hasOpenLesson: false, signedIn: true, signedOut: false };

describe("decideStaffTap", () => {
  it("first tap of the day is attendance (arrival)", () => {
    expect(decideStaffTap({ ...base, signedIn: false })).toEqual({ kind: "attendance" });
  });
  it("signed in with no open lesson shows the menu", () => {
    expect(decideStaffTap(base)).toEqual({ kind: "menu" });
  });
  it("an open lesson is ended by the next tap", () => {
    expect(decideStaffTap({ ...base, hasOpenLesson: true })).toEqual({ kind: "end_lesson" });
  });
  it("ignores a second tap within 10 seconds", () => {
    expect(decideStaffTap({ ...base, hasOpenLesson: true, lastTapAt: at("2026-11-16T08:59:52Z") })).toEqual({ kind: "duplicate" });
    expect(decideStaffTap({ ...base, hasOpenLesson: true, lastTapAt: at("2026-11-16T08:59:49Z") })).toEqual({ kind: "end_lesson" });
  });
  it("an already signed-out teacher gets the normal attendance answer", () => {
    expect(decideStaffTap({ ...base, signedOut: true })).toEqual({ kind: "attendance" });
  });
  it("an offline tap sent later never opens a menu", () => {
    expect(decideStaffTap({ ...base, tappedAt: at("2026-11-16T08:58:00Z") })).toEqual({ kind: "attendance" });
  });
});

describe("lesson flags", () => {
  const rules = { minMinutes: 20, maxMinutes: 90 };
  it("flags short, long and auto-closed lessons", () => {
    expect(lessonFlags(19, rules)).toEqual(["too_short"]);
    expect(lessonFlags(20, rules)).toEqual([]);
    expect(lessonFlags(90, rules)).toEqual([]);
    expect(lessonFlags(91, rules)).toEqual(["too_long"]);
    expect(lessonFlags(200, rules, true)).toEqual(["too_long", "auto_closed"]);
  });
  it("counts whole minutes", () => {
    expect(minutesBetween(at("2026-11-16T08:00:00Z"), at("2026-11-16T08:42:59Z"))).toBe(42);
    expect(minutesBetween(at("2026-11-16T08:00:00Z"), at("2026-11-16T07:00:00Z"))).toBe(0);
  });
});

describe("director alerts", () => {
  it("follows the chosen mode", () => {
    expect(directorWantsLesson("every", [])).toBe(true);
    expect(directorWantsLesson("flagged", [])).toBe(false);
    expect(directorWantsLesson("flagged", ["too_short"])).toBe(true);
    expect(directorWantsLesson("daily", ["too_short"])).toBe(false);
    expect(directorWantsLesson("off", ["too_long"])).toBe(false);
  });
  it("writes a short message", () => {
    expect(formatMinutes(42)).toBe("42 min");
    expect(formatMinutes(120)).toBe("2h");
    expect(formatMinutes(95)).toBe("1h 35m");
    expect(directorLessonMessage({ teacher: "Ada Obi", className: "JSS 2", subject: "Maths", minutes: 12, start: "9:00 AM", end: "9:12 AM", flags: ["too_short"], school: "Bright Stars" }))
      .toBe("Ada Obi taught JSS 2 Maths, 12 min (9:00 AM to 9:12 AM). Flagged: too short. Bright Stars, TapIn.");
  });
});
