/** Time helpers that always work in the school's own timezone. */

/** "HH:MM" (24h) of an instant in the given timezone. */
export function localTime(at: Date | string, timeZone: string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(d);
}

/** YYYY-MM-DD of an instant in the given timezone. */
export function localDate(at: Date | string, timeZone: string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(d);
}

/** Hour 0–23 in the given timezone. */
export function localHour(at: Date, timeZone: string): number {
  return Number(localTime(at, timeZone).slice(0, 2));
}

/** "7:42 AM" for people. */
export function friendlyTime(at: Date | string, timeZone: string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return new Intl.DateTimeFormat("en-NG", { hour: "numeric", minute: "2-digit", hour12: true, timeZone }).format(d).toUpperCase();
}

/** "07:45:00" | "07:45" → "07:45" */
export function hhmm(t: string): string {
  return t.slice(0, 5);
}
