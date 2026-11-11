/**
 * Teacher lesson rules (spec 2). Pure functions, unit tested. The database has the same flag rules
 * in public.lesson_flags() for lessons closed automatically.
 *
 *   First tap of the day             -> arrival (normal sign-in)
 *   Signed in, no open lesson        -> kiosk offers "Start lesson" / "Sign out"
 *   Lesson open                      -> the tap ends it and records the duration
 *   Tap within 10 seconds of the last -> ignored (duplicate)
 */

/** Taps closer together than this are the same tap. */
export const STAFF_DUPLICATE_MS = 10_000;
/** After a menu tap, the teacher has this long to choose on the kiosk. */
export const MENU_CHOICE_MS = 2 * 60_000;
/** An offline tap that reaches the server this late can't show a menu; it is treated as a plain tap. */
export const LIVE_TAP_MS = 60_000;

export type LessonFlag = "too_short" | "too_long" | "auto_closed";
export type DirectorMode = "off" | "every" | "flagged" | "daily";
export type LessonRules = { minMinutes: number; maxMinutes: number };

export const DEFAULT_RULES: LessonRules = { minMinutes: 20, maxMinutes: 90 };

export const FLAG_LABEL: Record<LessonFlag, string> = {
  too_short: "Too short",
  too_long: "Too long",
  auto_closed: "Not ended",
};

export function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60_000));
}

export function lessonFlags(minutes: number, rules: LessonRules, autoClosed = false): LessonFlag[] {
  const flags: LessonFlag[] = [];
  if (minutes < rules.minMinutes) flags.push("too_short");
  if (minutes > rules.maxMinutes) flags.push("too_long");
  if (autoClosed) flags.push("auto_closed");
  return flags;
}

export type StaffTapDecision =
  | { kind: "duplicate" }
  | { kind: "end_lesson" }
  | { kind: "attendance" } // first tap of the day, an already-signed-out teacher, or a late offline tap
  | { kind: "menu" };

/** What a teacher's tap does when lessons are switched on. */
export function decideStaffTap(opts: {
  tappedAt: Date;
  now: Date;
  lastTapAt: Date | null;
  hasOpenLesson: boolean;
  signedIn: boolean;
  signedOut: boolean;
}): StaffTapDecision {
  const { tappedAt, now, lastTapAt, hasOpenLesson, signedIn, signedOut } = opts;
  if (lastTapAt && Math.abs(tappedAt.getTime() - lastTapAt.getTime()) < STAFF_DUPLICATE_MS) return { kind: "duplicate" };
  if (hasOpenLesson) return { kind: "end_lesson" };
  if (!signedIn || signedOut) return { kind: "attendance" };
  // The teacher isn't standing at the kiosk any more (an offline tap sent later): no menu.
  if (now.getTime() - tappedAt.getTime() > LIVE_TAP_MS) return { kind: "attendance" };
  return { kind: "menu" };
}

/** Whether the director hears about this lesson as soon as it ends. */
export function directorWantsLesson(mode: DirectorMode, flags: readonly LessonFlag[]): boolean {
  return mode === "every" || (mode === "flagged" && flags.length > 0);
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** The SMS the director gets when a lesson ends. */
export function directorLessonMessage(l: {
  teacher: string; className: string; subject: string; minutes: number; start: string; end: string; flags: readonly LessonFlag[]; school: string;
}): string {
  const flagged = l.flags.length ? ` Flagged: ${l.flags.map((f) => FLAG_LABEL[f].toLowerCase()).join(", ")}.` : "";
  return `${l.teacher} taught ${l.className} ${l.subject}, ${formatMinutes(l.minutes)} (${l.start} to ${l.end}).${flagged} ${l.school}, TapIn.`;
}
