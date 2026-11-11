import type { SupabaseClient } from "@supabase/supabase-js";
import { localDate } from "@/lib/time";
import { rollCounts, type RollCounts } from "@/lib/emergency";

type Db = SupabaseClient;
export type ActiveEmergency = { id: string; kind: "real" | "drill"; started_at: string };

/** The school's roll call in progress, or null. Never throws (a database not yet updated means "none"). */
export async function activeEmergency(db: Db, schoolId: string): Promise<ActiveEmergency | null> {
  const { data, error } = await db.from("emergencies").select("id, kind, started_at").eq("school_id", schoolId).is("ended_at", null).maybeSingle();
  if (error || !data) return null;
  return data as ActiveEmergency;
}

export async function emergencyCounts(db: Db, emergencyId: string): Promise<RollCounts> {
  const { data } = await db.from("emergency_people").select("safe_at").eq("emergency_id", emergencyId);
  return rollCounts(data ?? []);
}

/**
 * Starts a roll call: everyone signed in today and not yet signed out (students and staff) goes on the roll.
 * If one is already running, returns that one.
 */
export async function startEmergency(db: Db, school: { id: string; timezone: string }, opts: {
  kind: "real" | "drill"; reason?: string | null; userId?: string | null; deviceId?: string | null;
}): Promise<{ id: string; created: boolean } | null> {
  const { data: created, error } = await db.from("emergencies").insert({
    school_id: school.id, kind: opts.kind, reason: opts.reason ?? null, started_by_user: opts.userId ?? null, started_device: opts.deviceId ?? null,
  }).select("id").single();
  if (error?.code === "23505") {
    const running = await activeEmergency(db, school.id);
    return running ? { id: running.id, created: false } : null;
  }
  if (error || !created) return null;

  const date = localDate(new Date(), school.timezone);
  const { data: present } = await db.from("attendance").select("holder_type, holder_id")
    .eq("school_id", school.id).eq("date", date).not("sign_in_at", "is", null).is("sign_out_at", null).limit(20_000);
  const studentIds = (present ?? []).filter((a) => a.holder_type === "student").map((a) => a.holder_id as string);
  const staffIds = (present ?? []).filter((a) => a.holder_type === "staff").map((a) => a.holder_id as string);
  const [{ data: students }, { data: staff }] = await Promise.all([
    studentIds.length ? db.from("students").select("id, first_name, last_name, classes(name)").in("id", studentIds) : Promise.resolve({ data: [] }),
    staffIds.length ? db.from("staff").select("id, name").in("id", staffIds) : Promise.resolve({ data: [] }),
  ]);
  const rows = [
    ...((students ?? []) as { id: string; first_name: string; last_name: string; classes: unknown }[]).map((s) => ({
      emergency_id: created.id, school_id: school.id, holder_type: "student", holder_id: s.id,
      name: `${s.first_name} ${s.last_name}`, group_name: (s.classes as { name: string } | null)?.name ?? "No class",
    })),
    ...((staff ?? []) as { id: string; name: string }[]).map((s) => ({
      emergency_id: created.id, school_id: school.id, holder_type: "staff", holder_id: s.id, name: s.name, group_name: "Staff",
    })),
  ];
  for (let i = 0; i < rows.length; i += 500) {
    const { error: e } = await db.from("emergency_people").insert(rows.slice(i, i + 500));
    if (e) console.error("emergency roster", e);
  }
  return { id: created.id, created: true };
}

/**
 * Marks someone safe (the first mark counts). Someone who wasn't tapped in but turns up is added to the roll as safe.
 */
export async function markSafe(db: Db, emergencyId: string, schoolId: string, who: {
  holder_type: "student" | "staff"; holder_id: string; name: string; group_name: string;
}, markedBy: string, at: Date): Promise<void> {
  const { data: existing } = await db.from("emergency_people").select("id, safe_at").eq("emergency_id", emergencyId)
    .eq("holder_type", who.holder_type).eq("holder_id", who.holder_id).maybeSingle();
  if (existing) {
    if (!existing.safe_at) await db.from("emergency_people").update({ safe_at: at.toISOString(), marked_by: markedBy }).eq("id", existing.id).is("safe_at", null);
    return;
  }
  const { error } = await db.from("emergency_people").insert({
    emergency_id: emergencyId, school_id: schoolId, ...who, on_roster: false, safe_at: at.toISOString(), marked_by: markedBy,
  });
  if (error && error.code !== "23505") console.error("emergency mark", error);
}
