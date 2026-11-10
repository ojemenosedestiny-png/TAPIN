import { existsSync, rmSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { FIXTURE_FILE, fixture } from "./fixture-data";

/** Deletes the throwaway school (cascades to everything in it) and its admin login. */
export default async function globalTeardown() {
  if (!existsSync(FIXTURE_FILE)) return;
  const f = fixture();
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  // Uploaded test photos
  for (const folder of ["student", "staff"]) {
    const { data } = await db.storage.from("photos").list(`${f.schoolId}/${folder}`);
    if (data?.length) await db.storage.from("photos").remove(data.map((o) => `${f.schoolId}/${folder}/${o.name}`));
  }
  await db.from("invoices").delete().eq("school_id", f.schoolId); // invoices protect a school from deletion
  await db.from("schools").delete().eq("id", f.schoolId);
  await db.auth.admin.deleteUser(f.adminUserId);
  if (f.superUserId) await db.auth.admin.deleteUser(f.superUserId);
  rmSync(FIXTURE_FILE, { force: true });
}
