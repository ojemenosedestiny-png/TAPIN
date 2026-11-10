/**
 * Sign-in / sign-out / duplicate rules (build plan §4 step 5). Pure functions — unit tested.
 *
 *   Tap within 5 minutes of the last tap      → duplicate (ignored)
 *   No sign-in today                          → sign in (late if after resumption time)
 *   Signed in, at/after closing time          → sign out
 *   Signed in, before closing, early release  → sign out (early)
 *   Signed in, before closing time            → duplicate ("already signed in")
 *   Already signed out                        → duplicate ("already signed out")
 */
import { hhmm, localDate, localTime } from "@/lib/time";

export const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
/** Offline taps older than this are refused (the kiosk queue should never be this stale). */
export const MAX_TAP_AGE_MS = 72 * 60 * 60 * 1000;
/** Allow for small clock differences between kiosk and server. */
export const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000;

export type SchoolDay = { timeZone: string; resumptionTime: string; closingTime: string };
export type AttendanceRow = { sign_in_at: string | null; sign_out_at: string | null };

export type TapDecision =
  | { kind: "sign_in"; late: boolean; date: string }
  | { kind: "sign_out"; date: string; early: boolean }
  | { kind: "duplicate"; reason: "recent_tap" | "already_signed_in" | "already_signed_out"; date: string };

export function decideTap(opts: {
  tappedAt: Date;
  lastTapAt: Date | null; // this person's previous tap (any result), if any
  today: AttendanceRow | null; // this person's attendance row for the tap's school-local date
  school: SchoolDay;
  earlyRelease?: boolean; // the office approved leaving before closing today
}): TapDecision {
  const { tappedAt, lastTapAt, today, school, earlyRelease = false } = opts;
  const date = localDate(tappedAt, school.timeZone);
  const time = localTime(tappedAt, school.timeZone);

  if (lastTapAt && Math.abs(tappedAt.getTime() - lastTapAt.getTime()) < DUPLICATE_WINDOW_MS) {
    return { kind: "duplicate", reason: "recent_tap", date };
  }
  if (!today?.sign_in_at) {
    return { kind: "sign_in", late: time > hhmm(school.resumptionTime), date };
  }
  if (today.sign_out_at) {
    return { kind: "duplicate", reason: "already_signed_out", date };
  }
  if (time >= hhmm(school.closingTime)) {
    return { kind: "sign_out", date, early: false };
  }
  if (earlyRelease) {
    return { kind: "sign_out", date, early: true };
  }
  return { kind: "duplicate", reason: "already_signed_in", date };
}

/** Validates the tap time a kiosk reports (offline taps carry their original time). */
export function resolveTapTime(reported: string | undefined, now: Date): { ok: true; at: Date } | { ok: false; reason: string } {
  if (!reported) return { ok: true, at: now };
  const at = new Date(reported);
  if (Number.isNaN(at.getTime())) return { ok: false, reason: "invalid_time" };
  if (at.getTime() - now.getTime() > MAX_CLOCK_SKEW_MS) return { ok: false, reason: "future_time" };
  if (now.getTime() - at.getTime() > MAX_TAP_AGE_MS) return { ok: false, reason: "too_old" };
  return { ok: true, at };
}
