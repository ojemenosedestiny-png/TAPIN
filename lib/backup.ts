/**
 * Nightly backup: every table as gzip'd NDJSON in the private "backups" bucket, plus a manifest.
 * Order matters: a restore inserts in this order so foreign keys resolve.
 */
export const BACKUP_TABLES = [
  { name: "schools", order: "id" },
  { name: "users", order: "id" },
  { name: "classes", order: "id" },
  { name: "students", order: "id" },
  { name: "guardians", order: "id" },
  { name: "student_guardians", order: "student_id" },
  { name: "staff", order: "id" },
  { name: "cards", order: "id" },
  { name: "devices", order: "id" },
  { name: "alert_settings", order: "school_id" },
  { name: "school_calendar", order: "date" },
  { name: "attendance", order: "id" },
  { name: "excusals", order: "id" },
  { name: "tap_events", order: "id" },
  { name: "sms_logs", order: "id" },
  { name: "notifications", order: "id" },
  { name: "audit_logs", order: "id" },
  // Added since the first backup. Left out on purpose: rate_limits, report_links and portal_deliveries
  // (short-lived), and portal_links (it holds the portal's key: re-enter it after a restore).
  { name: "platform_settings", order: "id" },
  { name: "demo_requests", order: "id" },
  { name: "orders", order: "id" },
  { name: "invoices", order: "id" },
  { name: "parent_payments", order: "id" },
  { name: "early_releases", order: "id" },
  { name: "subjects", order: "id" },
  { name: "lesson_settings", order: "school_id" },
  { name: "teacher_assignments", order: "id" },
  { name: "lessons", order: "id" },
  { name: "pickup_people", order: "id" },
  { name: "pickup_people_students", order: "person_id" },
  { name: "pickup_codes", order: "id" },
  { name: "pickup_code_students", order: "code_id" },
  { name: "pickup_events", order: "id" },
  { name: "emergency_settings", order: "school_id" },
  { name: "emergencies", order: "id" },
  { name: "emergency_people", order: "id" },
  { name: "whatsapp_messages", order: "id" },
] as const;

/** Columns the database calculates itself: left out when restoring. */
export const RESTORE_SKIP_COLUMNS: Record<string, string[]> = { lessons: ["duration_minutes"] };
/** Single-row-per-key tables that may already exist in the target (made by triggers or migrations): upserted. */
export const RESTORE_UPSERT: Record<string, string> = { alert_settings: "school_id", lesson_settings: "school_id", emergency_settings: "school_id", platform_settings: "id" };

export const BACKUP_BUCKET = "backups";
export const KEEP_BACKUPS = 14;

export type BackupManifest = {
  version: 1;
  created_at: string;
  tables: Record<string, number>;
  auth_users: number;
  note: string;
};

/** Which backup folders (named YYYY-MM-DD) to delete: everything but the newest `keep`. */
export function backupsToPrune(folders: string[], keep = KEEP_BACKUPS): string[] {
  return folders.filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort().reverse().slice(keep);
}

export function toNdjson(rows: unknown[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
}

/** True when the newest backup (YYYY-MM-DD) is missing or more than two days old. */
export function backupIsStale(latest: string | undefined, now = Date.now()): boolean {
  return !latest || now - Date.parse(`${latest}T23:59:59Z`) > 2 * 86_400_000;
}
