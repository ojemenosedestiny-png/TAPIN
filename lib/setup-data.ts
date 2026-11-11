import type { SupabaseClient } from "@supabase/supabase-js";
import type { SetupCounts } from "@/lib/setup";

/** Counts for the getting-started checklist. Runs as the school admin (RLS keeps it to their school). */
export async function loadSetupCounts(db: SupabaseClient): Promise<SetupCounts> {
  const head = { count: "exact" as const, head: true };
  const n = (r: { count: number | null }) => r.count ?? 0;
  const [settings, holidays, classes, teachers, students, consented, photos, cards, verified, kiosks, testAlert] = await Promise.all([
    db.from("audit_logs").select("id", head).eq("action", "school.update"),
    db.from("school_calendar").select("date", head),
    db.from("classes").select("id", head),
    db.from("users").select("id", head).eq("role", "teacher"),
    db.from("students").select("id", head).eq("status", "active"),
    db.from("students").select("id", head).eq("status", "active").not("consent_at", "is", null),
    db.from("students").select("id", head).eq("status", "active").not("consent_at", "is", null).not("photo_url", "is", null),
    db.from("student_overview").select("id", head).eq("status", "active").eq("card_status", "active"),
    db.from("student_overview").select("id", head).eq("status", "active").eq("card_state", "verified"),
    db.from("devices").select("id", head).is("revoked_at", null),
    db.from("audit_logs").select("id", head).eq("action", "alerts.test"),
  ]);
  return {
    settingsSaved: n(settings) > 0,
    holidays: n(holidays),
    classes: n(classes),
    teachers: n(teachers),
    students: n(students),
    consented: n(consented),
    photos: n(photos),
    cards: n(cards),
    verified: n(verified),
    kiosks: n(kiosks),
    testAlert: n(testAlert) > 0,
  };
}
