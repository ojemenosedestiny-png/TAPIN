import { gzipSync } from "node:zlib";
import { NextResponse, type NextRequest } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { BACKUP_BUCKET, BACKUP_TABLES, backupsToPrune, toNdjson, type BackupManifest } from "@/lib/backup";
import { fetchAllPages } from "@/lib/reports";

export const maxDuration = 60;

/**
 * GET /api/cron/backup — nightly copy of the whole database into the private "backups" bucket
 * (one gzip'd NDJSON file per table + manifest.json), keeping the newest 14. Photos are not copied
 * (they stay in their own bucket); login passwords can't be exported, so restored staff reset theirs.
 */
export async function GET(req: NextRequest) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const day = new Date().toISOString().slice(0, 10);
  const manifest: BackupManifest = { version: 1, created_at: new Date().toISOString(), tables: {}, auth_users: 0, note: "" };

  const put = async (name: string, body: string) => {
    const { error } = await db.storage.from(BACKUP_BUCKET).upload(`${day}/${name}`, gzipSync(Buffer.from(body, "utf8")), {
      contentType: "application/gzip", upsert: true,
    });
    if (error) throw new Error(`upload ${name}: ${error.message}`);
  };

  try {
    for (const t of BACKUP_TABLES) {
      const rows = await fetchAllPages<Record<string, unknown>>((f, to) => db.from(t.name).select("*").order(t.order).range(f, to));
      await put(`${t.name}.ndjson.gz`, toNdjson(rows));
      manifest.tables[t.name] = rows.length;
    }
    // Logins (ids and emails, so restored profiles keep their link). Password hashes aren't exportable.
    const users: Record<string, unknown>[] = [];
    for (let page = 1; page < 100; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error(`auth users: ${error.message}`);
      users.push(...data.users.map((u) => ({ id: u.id, email: u.email, phone: u.phone, created_at: u.created_at, email_confirmed_at: u.email_confirmed_at })));
      if (data.users.length < 1000) break;
    }
    await put("auth_users.ndjson.gz", toNdjson(users));
    manifest.auth_users = users.length;
    manifest.note = "Restore with scripts/backup.mjs into an EMPTY project. Staff must use Forgot password after a restore.";
    await db.storage.from(BACKUP_BUCKET).upload(`${day}/manifest.json`, JSON.stringify(manifest, null, 2), { contentType: "application/json", upsert: true });
  } catch (e) {
    console.error("backup", e);
    return NextResponse.json({ error: "Backup failed.", detail: (e as Error).message }, { status: 500 });
  }

  // Keep the newest 14.
  const { data: folders } = await db.storage.from(BACKUP_BUCKET).list("", { limit: 1000 });
  const prune = backupsToPrune((folders ?? []).map((f) => f.name));
  for (const folder of prune) {
    const { data: files } = await db.storage.from(BACKUP_BUCKET).list(folder, { limit: 1000 });
    if (files?.length) await db.storage.from(BACKUP_BUCKET).remove(files.map((f) => `${folder}/${f.name}`));
  }

  return NextResponse.json({ ok: true, day, ...manifest, pruned: prune });
}
