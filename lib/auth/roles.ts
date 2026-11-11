export const ROLES = ["super_admin", "school_admin", "teacher"] as const;
export type Role = (typeof ROLES)[number];

export type Area =
  | "platform" // schools, school admins, platform health (super admin)
  | "today"
  | "setup"
  | "students"
  | "staff"
  | "classes"
  | "cards"
  | "devices"
  | "alerts"
  | "reports"
  | "settings"
  | "enroll"
  | "help"
  | "account"
  | "invoices"
  | "activity"
  | "lessons"
  | "my-report"
  | "pickup"
  | "emergency";

const ACCESS: Record<Role, readonly Area[]> = {
  // No routine access to student records.
  super_admin: ["platform", "help", "account", "invoices", "activity"],
  school_admin: ["today", "setup", "students", "staff", "lessons", "pickup", "emergency", "classes", "cards", "devices", "alerts", "reports", "settings", "enroll", "help", "account", "invoices", "activity"],
  teacher: ["today", "students", "reports", "my-report", "emergency", "help", "account"],
};

export function canAccess(role: Role, area: Area): boolean {
  return ACCESS[role].includes(area);
}

/** Where a user lands after logging in. */
export function homePath(role: Role): string {
  return role === "super_admin" ? "/platform" : "/today";
}

/** Maps a URL path to the dashboard area it belongs to, or null for non-protected paths. */
export function areaForPath(pathname: string): Area | null {
  const first = pathname.split("/").filter(Boolean)[0] ?? "";
  const areas: readonly string[] = [
    "platform", "today", "setup", "students", "staff", "classes", "cards", "devices", "alerts", "reports", "settings", "enroll", "help", "account", "invoices", "activity", "lessons", "my-report", "pickup", "emergency",
  ];
  return areas.includes(first) ? (first as Area) : null;
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
