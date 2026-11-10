import { readFileSync } from "node:fs";
import { join } from "node:path";

export const FIXTURE_FILE = join(process.cwd(), "test-results", "e2e-fixture.json");
/** Saved login session for the test school admin (written by auth.setup.ts). */
export const ADMIN_STATE = join(process.cwd(), "test-results", "e2e-admin-state.json");

export type Fixture = {
  schoolId: string;
  schoolName: string;
  adminEmail: string;
  adminPassword: string;
  adminUserId: string;
  superEmail: string;
  superUserId: string;
  deviceToken: string;
  classId: string;
  className: string;
  students: { id: string; name: string; admissionNo: string }[];
  kioskStudent: { id: string; name: string; uid: string };
};

export function fixture(): Fixture {
  return JSON.parse(readFileSync(FIXTURE_FILE, "utf8"));
}

/** A fresh, valid-looking card UID for each test run. */
export function freshUid(prefix: string): string {
  return `${prefix}${Date.now().toString(16).toUpperCase()}${Math.floor(Math.random() * 256).toString(16).padStart(2, "0").toUpperCase()}`.slice(0, 14);
}
