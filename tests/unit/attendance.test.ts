import { describe, expect, it } from "vitest";
import { decideTap, resolveTapTime } from "@/lib/attendance";
import { greetingForHour, spokenGreeting } from "@/lib/greeting";

// Lagos is UTC+1 all year. 06:42Z = 07:42 local.
const school = { timeZone: "Africa/Lagos", resumptionTime: "07:45:00", closingTime: "14:00:00" };
const at = (hhmmLocal: string, date = "2026-11-10") => {
  const [h, m] = hhmmLocal.split(":").map(Number);
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h! - 1, m!));
};

describe("tap rules (build plan §4 step 5)", () => {
  it("first tap of the day signs in, on time", () => {
    expect(decideTap({ tappedAt: at("07:42"), lastTapAt: null, today: null, school })).toEqual({ kind: "sign_in", late: false, date: "2026-11-10" });
  });

  it("first tap after resumption time is late", () => {
    expect(decideTap({ tappedAt: at("08:20"), lastTapAt: null, today: null, school })).toMatchObject({ kind: "sign_in", late: true });
    expect(decideTap({ tappedAt: at("07:45"), lastTapAt: null, today: null, school })).toMatchObject({ kind: "sign_in", late: false });
    expect(decideTap({ tappedAt: at("07:46"), lastTapAt: null, today: null, school })).toMatchObject({ kind: "sign_in", late: true });
  });

  it("a tap within 5 minutes of the last tap is a duplicate", () => {
    const r = decideTap({ tappedAt: at("07:46"), lastTapAt: at("07:42"), today: { sign_in_at: at("07:42").toISOString(), sign_out_at: null }, school });
    expect(r).toMatchObject({ kind: "duplicate", reason: "recent_tap" });
    // even a first sign-in is held back if the card was just tapped (e.g. a blocked→unblocked retry)
    expect(decideTap({ tappedAt: at("07:44"), lastTapAt: at("07:42"), today: null, school })).toMatchObject({ kind: "duplicate" });
  });

  it("signed in, tapping again before closing time does not sign out", () => {
    const today = { sign_in_at: at("07:42").toISOString(), sign_out_at: null };
    expect(decideTap({ tappedAt: at("11:00"), lastTapAt: at("07:42"), today, school })).toMatchObject({ kind: "duplicate", reason: "already_signed_in" });
  });

  it("signed in, tapping at or after closing time signs out", () => {
    const today = { sign_in_at: at("07:42").toISOString(), sign_out_at: null };
    expect(decideTap({ tappedAt: at("14:00"), lastTapAt: at("07:42"), today, school })).toEqual({ kind: "sign_out", date: "2026-11-10" });
    expect(decideTap({ tappedAt: at("14:15"), lastTapAt: at("07:42"), today, school })).toMatchObject({ kind: "sign_out" });
  });

  it("already signed out stays signed out", () => {
    const today = { sign_in_at: at("07:42").toISOString(), sign_out_at: at("14:15").toISOString() };
    expect(decideTap({ tappedAt: at("15:00"), lastTapAt: at("14:15"), today, school })).toMatchObject({ kind: "duplicate", reason: "already_signed_out" });
  });

  it("a tap after closing with no sign-in still signs in (late)", () => {
    expect(decideTap({ tappedAt: at("14:30"), lastTapAt: null, today: null, school })).toMatchObject({ kind: "sign_in", late: true });
  });

  it("uses the school's local date, not UTC", () => {
    // 23:30 UTC on the 9th is 00:30 on the 10th in Lagos.
    const t = new Date("2026-11-09T23:30:00Z");
    expect(decideTap({ tappedAt: t, lastTapAt: null, today: null, school }).date).toBe("2026-11-10");
  });
});

describe("offline tap times", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  it("uses now when the kiosk sends no time", () => {
    expect(resolveTapTime(undefined, now)).toEqual({ ok: true, at: now });
  });
  it("accepts queued taps from earlier", () => {
    const r = resolveTapTime("2026-11-10T06:42:00Z", now);
    expect(r.ok && r.at.toISOString()).toBe("2026-11-10T06:42:00.000Z");
  });
  it("rejects garbage, future and very old times", () => {
    expect(resolveTapTime("yesterday", now)).toMatchObject({ ok: false, reason: "invalid_time" });
    expect(resolveTapTime("2026-11-10T12:10:00Z", now)).toMatchObject({ ok: false, reason: "future_time" });
    expect(resolveTapTime("2026-11-10T12:01:00Z", now).ok).toBe(true); // small clock skew is fine
    expect(resolveTapTime("2026-11-05T12:00:00Z", now)).toMatchObject({ ok: false, reason: "too_old" });
  });
});

describe("greeting (build plan §4 step 7)", () => {
  it("good morning before 12, afternoon 12–16, evening after", () => {
    expect(greetingForHour(6)).toBe("Good morning");
    expect(greetingForHour(11)).toBe("Good morning");
    expect(greetingForHour(12)).toBe("Good afternoon");
    expect(greetingForHour(15)).toBe("Good afternoon");
    expect(greetingForHour(16)).toBe("Good evening");
  });
  it("speaks the plan's phrases", () => {
    expect(spokenGreeting("signed_in", "Chioma", 7)).toBe("Good morning, Chioma, welcome to school");
    expect(spokenGreeting("signed_in", "Chioma", 13)).toBe("Good afternoon, Chioma, welcome to school");
    expect(spokenGreeting("signed_out", "Chioma", 14)).toBe("Goodbye, Chioma, take care");
  });
});
