import { createAdminClient } from "@/lib/supabase/admin";

export type AuditEntry = {
  schoolId: string | null;
  actorId: string | null;
  action: string; // e.g. "school.create", "user.create", "card.block"
  entity: string; // table name
  entityId?: string | null;
  details?: Record<string, unknown>;
};

/** Writes one audit row. Server only. Throws if the write fails so sensitive actions are never unlogged. */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  const { error } = await createAdminClient().from("audit_logs").insert({
    school_id: entry.schoolId,
    actor_id: entry.actorId,
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entityId ?? null,
    details: entry.details ?? {},
  });
  if (error) throw new Error(`Audit log write failed: ${error.message}`);
}
