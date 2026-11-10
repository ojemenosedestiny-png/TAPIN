import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { generateDeviceToken, hashDeviceToken } from "../../lib/devices";
import { FIXTURE_FILE, freshUid, type Fixture } from "./fixture-data";

/** Seeds a throwaway school for the browser tests. Removed again in global-teardown. */
export default async function globalSetup() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("E2E tests need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (use a dev project).");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const tag = `e2e-${Date.now()}`;

  const ins = async (table: string, row: Record<string, unknown>) => {
    const { data, error } = await db.from(table).insert(row).select("id").single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data.id as string;
  };

  const schoolName = `E2E School ${tag}`;
  const schoolId = await ins("schools", { name: schoolName, resumption_time: "07:45", closing_time: "14:00", absence_cutoff_time: "09:00" });
  const adminEmail = `${tag}@example.com`;
  const adminPassword = `E2e-${randomUUID()}A1`;
  const { data: authUser, error } = await db.auth.admin.createUser({ email: adminEmail, password: adminPassword, email_confirm: true });
  if (error || !authUser.user) throw error ?? new Error("createUser failed");
  await db.from("users").insert({ id: authUser.user.id, school_id: schoolId, name: "Ada Admin", email: adminEmail, role: "school_admin" });

  const className = "JSS2A";
  const classId = await ins("classes", { school_id: schoolId, name: className });
  const people = [["Chioma", "Okafor"], ["David", "Bello"], ["Amaka", "Eze"], ["Tunde", "Bakare"]] as const;
  const students = [];
  for (const [i, [first, last]] of people.entries()) {
    const admissionNo = `E2E00${i + 1}`;
    const id = await ins("students", { school_id: schoolId, class_id: classId, admission_no: admissionNo, first_name: first, last_name: last });
    students.push({ id, name: `${first} ${last}`, admissionNo });
  }

  // A separate student, already carded, for the kiosk tests.
  const kioskId = await ins("students", { school_id: schoolId, admission_no: "E2E-K1", first_name: "Kemi", last_name: "Adeyemi", class_id: classId });
  const kioskUid = freshUid("0C");
  await ins("cards", { school_id: schoolId, uid: kioskUid, holder_type: "student", holder_id: kioskId, verified_at: new Date().toISOString() });

  const deviceToken = generateDeviceToken();
  await ins("devices", { school_id: schoolId, name: "E2E Gate", token_hash: hashDeviceToken(deviceToken) });

  const data: Fixture = {
    schoolId, schoolName, adminEmail, adminPassword, adminUserId: authUser.user.id, deviceToken, classId, className,
    students, kioskStudent: { id: kioskId, name: "Kemi Adeyemi", uid: kioskUid },
  };
  mkdirSync(dirname(FIXTURE_FILE), { recursive: true });
  writeFileSync(FIXTURE_FILE, JSON.stringify(data, null, 2));
}
