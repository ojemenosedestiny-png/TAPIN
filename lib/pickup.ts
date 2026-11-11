/**
 * Safe pickup (spec 6). Pure helpers, unit tested.
 *
 *   Pickup card or one-day code at the kiosk -> the person's photo next to their linked children
 *   -> staff confirm -> each child is signed out and their parents get an SMS.
 *   Revoked person or blocked card -> red "Not authorised"; admin and parents are told.
 */
import { createHash, randomInt } from "node:crypto";

/** Staff have this long after the tap to confirm on the kiosk. */
export const PICKUP_CONFIRM_MS = 3 * 60_000;

export type PickupChildState = "in_school" | "signed_out" | "not_in";

export type PickupChild = { id: string; name: string; first_name: string; class: string | null; photo_url: string | null; state: PickupChildState };

/** "123456" from "123 456", "123-456" etc.; null unless exactly 6 digits. */
export function normalisePickupCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

export function newPickupCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Codes are stored hashed, salted with the school id. */
export function hashPickupCode(schoolId: string, code: string): string {
  return createHash("sha256").update(`${schoolId}:${code}`).digest("hex");
}

export function childState(att: { sign_in_at: string | null; sign_out_at: string | null } | undefined): PickupChildState {
  if (!att?.sign_in_at) return "not_in";
  return att.sign_out_at ? "signed_out" : "in_school";
}

/** "Ada", "Ada and Tolu", "Ada, Tolu and Femi". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The parent's message: "[Child] was picked up by [person] at [time]." */
export function pickupMessage(o: { child: string; picker: string; relationship?: string | null; time: string; school: string }): string {
  const who = o.relationship ? `${o.picker} (${o.relationship.toLowerCase()})` : o.picker;
  return `${o.child} was picked up by ${who} at ${o.time}. ${o.school}.`;
}

/** Sent to the parents of a child when a revoked or blocked pickup card is used. */
export function notAuthorisedMessage(o: { picker: string; time: string; school: string }): string {
  return `${o.school}: ${o.picker} tried to collect your child at ${o.time} but is not authorised. Your child was not released. Call the school if this is unexpected.`;
}
