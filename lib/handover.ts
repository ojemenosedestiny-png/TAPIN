/**
 * Parent handover at the gate (spec features 1-4). Pure rules, unit tested; lib/handover-server.ts does the work.
 *
 *   Drop-off: the child taps (signed in) → a 2-minute window → the parent taps → matched, and that parent is told.
 *             No parent in time → the child stays signed in, the usual arrival message goes out, staff see a flag.
 *   Pickup:   the parent (or a one-day code) opens a 2-minute window → each child taps → matched
 *             → staff confirm the faces → signed out, parents told. A child not linked to that person is refused.
 *   Bus:      the child taps alone, both ways.
 */

/** How long a parent has to tap after their child at drop-off, and a child after their parent at pickup. */
export const HANDOVER_MS = 2 * 60_000;

/** Wrong pickup codes before code entry on that kiosk locks, and for how long. */
export const CODE_LOCK_AFTER = 5;
export const CODE_LOCK_MS = 15 * 60_000;

export type Transport = "parent" | "bus";

/** Which flow a child's tap follows. Handover only applies when the school has switched it on. */
export function handoverMode(o: { transport: Transport | null | undefined; handoverEnabled: boolean }): "handover" | "bus" | "alone" {
  if (o.transport === "bus") return "bus";
  return o.handoverEnabled ? "handover" : "alone";
}

export function windowExpiry(start: Date): Date {
  return new Date(start.getTime() + HANDOVER_MS);
}

export function isOpen(h: { status: string; expires_at: string }, now: Date): boolean {
  return h.status === "waiting" && new Date(h.expires_at).getTime() > now.getTime();
}

/** After a wrong code: the new failure count, and when code entry unlocks (null while still allowed). */
export function afterWrongCode(failures: number, now: Date): { failures: number; lockedUntil: Date | null } {
  const n = failures + 1;
  return n >= CODE_LOCK_AFTER ? { failures: 0, lockedUntil: new Date(now.getTime() + CODE_LOCK_MS) } : { failures: n, lockedUntil: null };
}

export function codeLocked(lockedUntil: string | null | undefined, now: Date): boolean {
  return !!lockedUntil && new Date(lockedUntil).getTime() > now.getTime();
}

// ------------------------------------------------------------------ messages (each starts with the school's name)

/** To the parent who handed the child over. */
export function dropoffMessage(o: { child: string; time: string; school: string }): string {
  return `${o.school}: ${o.child} has checked in at ${o.time}.`;
}

/** To the child's parents when someone else (an aunt, a driver) handed them over. */
export function dropoffByMessage(o: { child: string; by: string; time: string; school: string }): string {
  return `${o.school}: ${o.child} has checked in at ${o.time}, dropped off by ${o.by}.`;
}

export function busArrivalMessage(o: { child: string; time: string; school: string }): string {
  return `${o.school}: ${o.child} has arrived at school at ${o.time}.`;
}

export function busDepartureMessage(o: { child: string; time: string; school: string }): string {
  return `${o.school}: ${o.child} has left school on the bus at ${o.time}.`;
}

/** To the parent who made the code. */
export function codeCollectedMessage(o: { child: string; time: string; school: string; by?: string | null }): string {
  return `${o.school}: ${o.child} was collected with your pickup code at ${o.time}${o.by ? ` by ${o.by}` : ""}.`;
}

export function latePickupMessage(o: { child: string; time: string; school: string; closing: string }): string {
  return `${o.school}: ${o.child} is still at school at ${o.time}. School closed at ${o.closing}. Please collect them, or call the school if there's a problem.`;
}

/** For the admin dashboard when someone tries to collect a child they aren't linked to. */
export function refusedNotice(o: { picker: string; child: string; place: string; time: string }): string {
  return `${o.picker} tried to collect ${o.child} at ${o.place}, ${o.time}, but is not linked to them. The child was not released.`;
}

export function noParentNotice(o: { child: string; className: string | null; time: string }): string {
  return `${o.child}${o.className ? ` (${o.className})` : ""} signed in at ${o.time}, but no parent tapped to hand them over.`;
}

/** Is pickup code entry locked on a kiosk right now? (For pages: reads the clock here, not while rendering.) */
export function codeLockedNow(lockedUntil: string | null | undefined): boolean {
  return codeLocked(lockedUntil, new Date());
}
