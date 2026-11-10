/**
 * Pure alert rules (no server code) — safe to use in the browser for the template editor.
 */
import { hhmm, localTime } from "@/lib/time";

export const ALERT_TYPES = ["arrival", "departure", "late", "absence", "early"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const MAX_ATTEMPTS = 4; // first try + 3 retries
export const RETRY_DELAY_MS = 2 * 60 * 1000;
/** Arrival/departure news older than this isn't worth sending (e.g. queued while SMS was down). */
export const MESSAGE_TTL_MS = 6 * 60 * 60 * 1000;

export const TEMPLATE_FIELDS = ["greeting", "full_name", "first_name", "school", "time", "date", "reason"] as const;

/** Example values for previews and test messages. */
export const SAMPLE_VARS = { greeting: "Good morning", full_name: "Chioma Okafor", first_name: "Chioma", time: "7:42 AM", date: "Tuesday 10 November", reason: "Sick, collected by mother" };

/** A test alert: the school's real template with sample values, clearly marked so no parent mistakes it for news. */
export function testAlertMessage(template: string, school: string): string {
  return `TEST: ${renderTemplate(template, { ...SAMPLE_VARS, school })}`;
}

export type AlertSettings = {
  arrival_enabled: boolean;
  departure_enabled: boolean;
  late_enabled: boolean;
  absence_enabled: boolean;
  arrival_template: string;
  departure_template: string;
  late_template: string;
  absence_template: string;
  early_template: string;
  summary_mode: boolean;
  summary_time: string;
  quiet_start: string;
  quiet_end: string;
  monthly_allowance: number;
};

/** Same rules as the SQL render_template(): unknown {fields} are left as typed. */
export function renderTemplate(template: string, vars: Partial<Record<(typeof TEMPLATE_FIELDS)[number], string>>): string {
  return template.replace(/\{([a-z_]+)\}/g, (m, key: string) => (key in vars ? (vars as Record<string, string>)[key] ?? "" : m));
}

/** Fields used in a template that we don't know about (shown as a warning in the editor). */
export function unknownFields(template: string): string[] {
  return [...template.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]!).filter((k) => !(TEMPLATE_FIELDS as readonly string[]).includes(k));
}

/** SMS pages: 160 chars for one page, 153 per page after that (GSM-7). */
export function smsPages(text: string): number {
  return text.length <= 160 ? 1 : Math.ceil(text.length / 153);
}

/** Which SMS a tap should create. Late replaces arrival; summary mode holds arrival/departure for the evening SMS. */
export function alertForTap(action: "signed_in" | "signed_out", late: boolean, s: Pick<AlertSettings, "arrival_enabled" | "departure_enabled" | "late_enabled" | "summary_mode">, early = false): AlertType | null {
  // A child leaving early is always told to the parents straight away, whatever the other switches say.
  if (action === "signed_out" && early) return "early";
  if (action === "signed_in") {
    if (late && s.late_enabled) return "late";
    if (s.summary_mode) return null;
    return s.arrival_enabled ? "arrival" : null;
  }
  if (s.summary_mode) return null;
  return s.departure_enabled ? "departure" : null;
}

/** Is local time HH:MM inside quiet hours [start, end)? Handles windows that cross midnight. */
export function inQuietHours(time: string, start: string, end: string): boolean {
  const t = hhmm(time), a = hhmm(start), b = hhmm(end);
  if (a === b) return false;
  return a < b ? t >= a && t < b : t >= a || t < b;
}

/** Next moment (UTC) the quiet window ends, given the school timezone. */
export function quietEndsAt(now: Date, quietEnd: string, timeZone: string): Date {
  const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
  const diff = (toMin(hhmm(quietEnd)) - toMin(localTime(now, timeZone)) + 1440) % 1440 || 1440;
  const at = new Date(now.getTime() + diff * 60_000);
  at.setUTCSeconds(0, 0);
  return at;
}

/** Template values for a WhatsApp template: {{1}} name, {{2}} school, {{3}} time/date, {{4}} reason. */
export function whatsappData(vars: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["1", "2", "3", "4"]) {
    const v = vars[k];
    if (typeof v === "string" && v.trim()) out[k] = v;
  }
  return out;
}

/** WhatsApp only when the guardian chose it and a template exists for this kind of message. */
export function chooseChannel(guardianChannel: string | null | undefined, hasTemplate: boolean): "sms" | "whatsapp" {
  return guardianChannel === "whatsapp" && hasTemplate ? "whatsapp" : "sms";
}
