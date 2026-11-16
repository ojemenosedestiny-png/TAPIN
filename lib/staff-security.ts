/**
 * Staff check-in security (pure rules, unit tested). The school chooses in Settings:
 * PIN after the card, a kiosk photo at each tap, alerts, and the hours staff may check in.
 */

import { randomInt } from "node:crypto";

export const STAFF_PIN_LOCK_AFTER = 5;
export const STAFF_PIN_LOCK_MS = 15 * 60_000;
/** A kiosk photo: a small JPEG as a data URL (about 20–60 KB at 320×240). */
export const MAX_PHOTO_CHARS = 300_000;

export type StaffSecurity = { pinRequired: boolean; photo: boolean; alerts: boolean; from: string | null; until: string | null };

export function staffSecurityFrom(s: { staff_pin_required?: boolean | null; staff_photo?: boolean | null; staff_alerts?: boolean | null; staff_from?: string | null; staff_until?: string | null }): StaffSecurity {
  return { pinRequired: !!s.staff_pin_required, photo: !!s.staff_photo, alerts: !!s.staff_alerts, from: s.staff_from?.slice(0, 5) ?? null, until: s.staff_until?.slice(0, 5) ?? null };
}

/** Exactly 4 digits. */
export function validStaffPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{4}$/.test(pin);
}

/** PINs that are too easy to guess. */
export function weakPin(pin: string): boolean {
  return /^(\d)\1{3}$/.test(pin) || ["1234", "4321", "0123", "1212", "2580", "1122", "6789", "9876"].includes(pin);
}

/** "HH:MM" local time is inside [from, until]; no limit when either is missing. Handles windows past midnight. */
export function withinStaffHours(localHHMM: string, from: string | null, until: string | null): boolean {
  if (!from || !until) return true;
  return from <= until ? localHHMM >= from && localHHMM <= until : localHHMM >= from || localHHMM <= until;
}

export function staffPinLocked(lockedUntil: string | null | undefined, now: Date): boolean {
  return !!lockedUntil && new Date(lockedUntil).getTime() > now.getTime();
}

/** After a wrong PIN: the new failure count, and when the person is locked out until (5th wrong try). */
export function afterWrongStaffPin(failures: number, now: Date): { failures: number; lockedUntil: string | null; triesLeft: number } {
  const next = failures + 1;
  if (next >= STAFF_PIN_LOCK_AFTER) return { failures: 0, lockedUntil: new Date(now.getTime() + STAFF_PIN_LOCK_MS).toISOString(), triesLeft: 0 };
  return { failures: next, lockedUntil: null, triesLeft: STAFF_PIN_LOCK_AFTER - next };
}

/** A JPEG data URL from the kiosk camera, within size; returns the raw bytes or null. */
export function decodeKioskPhoto(dataUrl: unknown): Buffer | null {
  if (typeof dataUrl !== "string" || dataUrl.length > MAX_PHOTO_CHARS) return null;
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!m) return null;
  const bytes = Buffer.from(m[1]!, "base64");
  // JPEG files start FF D8 FF.
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? bytes : null;
}

/** Where a staff tap photo is kept: <school>/staff-taps/<date>/<staff>-<time>.jpg (deleted after 30 days). */
export function staffPhotoPath(schoolId: string, date: string, staffId: string, at: Date): string {
  return `${schoolId}/staff-taps/${date}/${staffId}-${at.getTime()}.jpg`;
}

export const STAFF_PHOTO_DAYS = 30;

/** For pages: locked right now? (kept out of render so the clock read is explicit). */
export function staffPinLockedNow(lockedUntil: string | null | undefined): boolean {
  return staffPinLocked(lockedUntil, new Date());
}

/** ISO time n days ago, for "last 7 days" queries. */
export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** A fresh 4-digit PIN that isn't one of the easy ones (for staff who ask the WhatsApp assistant). */
export function newStaffPin(rand: (max: number) => number = (max) => randomInt(0, max)): string {
  for (;;) {
    const pin = String(rand(10_000)).padStart(4, "0");
    if (!weakPin(pin)) return pin;
  }
}
