// TapIn backups: list, check, download, and restore into an EMPTY Supabase project.
//
//   node --env-file=.env.local scripts/backup.mjs list
//   node --env-file=.env.local scripts/backup.mjs check 2026-11-11          (downloads and verifies counts)
//   node --env-file=.env.local scripts/backup.mjs download 2026-11-11 ./backup-2026-11-11
//   node --env-file=<target env> scripts/backup.mjs restore ./backup-2026-11-11
//
// Restore needs the migrations already applied to the target project, and refuses to run if the
// target already has any school (it never overwrites). Logins are recreated with their original
// ids and emails but no password: everyone uses "Forgot password?" afterwards.
import { createClient } from "@supabase/supabase-js";
import { gunzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

// Same order as BACKUP_TABLES in lib/backup.ts (a unit test keeps them in step).
const TABLES = ["schools", "users", "classes", "students", "guardians", "student_guardians", "staff", "cards", "devices",
  "alert_settings", "school_calendar", "attendance", "excusals", "tap_events", "sms_logs", "notifications", "audit_logs",
  "platform_settings", "demo_requests", "orders", "invoices", "parent_payments", "early_releases", "subjects", "lesson_settings",
  "teacher_assignments", "lessons", "pickup_people", "pickup_people_students", "pickup_codes", "pickup_code_students", "pickup_events",
  "emergency_settings", "emergencies", "emergency_people", "whatsapp_messages"];
// Columns the database calculates itself, and tables whose row may already exist in the target.
const SKIP_COLUMNS = { lessons: ["duration_minutes"] };
const UPSERT = { alert_settings: "school_id", lesson_settings: "school_id", emergency_settings: "school_id", platform_settings: "id" };
// Identity columns that must be inserted with their original values.
const IDENTITY = new Set(["tap_events", "notifications", "audit_logs"]);

const [cmd, arg1, arg2] = process.argv.slice(2);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (use --env-file)."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const bucket = db.storage.from("backups");

const parse = (buf) => gunzipSync(buf).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

async function fetchBackup(day) {
  const files = {};
  const { data: m, error } = await bucket.download(`${day}/manifest.json`);
  if (error) throw new Error(`No backup for ${day}: ${error.message}`);
  const manifest = JSON.parse(await m.text());
  for (const name of [...TABLES, "auth_users"]) {
    // Older backups were made before some tables existed: only fetch what the manifest lists.
    if (name !== "auth_users" && !(name in manifest.tables)) continue;
    const { data, error: e } = await bucket.download(`${day}/${name}.ndjson.gz`);
    if (e) throw new Error(`Missing ${name}: ${e.message}`);
    files[name] = Buffer.from(await data.arrayBuffer());
  }
  return { manifest, files };
}

function verify(manifest, files) {
  let ok = true;
  for (const name of TABLES) {
    if (!files[name]) { console.log(`--  ${name.padEnd(18)} not in this backup (made before the table existed)`); continue; }
    const rows = parse(files[name]).length;
    const expected = manifest.tables[name];
    const good = rows === expected;
    ok &&= good;
    console.log(`${good ? "ok " : "BAD"} ${name.padEnd(18)} ${String(rows).padStart(8)} rows${good ? "" : ` (manifest says ${expected})`}`);
  }
  const users = parse(files.auth_users).length;
  console.log(`${users === manifest.auth_users ? "ok " : "BAD"} ${"auth_users".padEnd(18)} ${String(users).padStart(8)} logins`);
  return ok && users === manifest.auth_users;
}

if (cmd === "list") {
  const { data, error } = await bucket.list("", { limit: 1000, sortBy: { column: "name", order: "desc" } });
  if (error) { console.error(error.message); process.exit(1); }
  for (const f of data ?? []) console.log(f.name);
  if (!data?.length) console.log("(no backups yet)");
} else if (cmd === "check" && arg1) {
  const { manifest, files } = await fetchBackup(arg1);
  console.log(`Backup ${arg1}, made ${manifest.created_at}`);
  process.exit(verify(manifest, files) ? 0 : 1);
} else if (cmd === "download" && arg1 && arg2) {
  const { manifest, files } = await fetchBackup(arg1);
  if (!verify(manifest, files)) { console.error("Backup failed its check; not saved."); process.exit(1); }
  mkdirSync(arg2, { recursive: true });
  writeFileSync(join(arg2, "manifest.json"), JSON.stringify(manifest, null, 2));
  for (const [name, buf] of Object.entries(files)) writeFileSync(join(arg2, `${name}.ndjson.gz`), buf);
  console.log(`Saved to ${arg2}`);
} else if (cmd === "restore" && arg1) {
  if (!existsSync(join(arg1, "manifest.json"))) { console.error(`${arg1} is not a downloaded backup folder.`); process.exit(1); }
  const { count } = await db.from("schools").select("id", { count: "exact", head: true });
  if (count) { console.error(`Refusing: the target project already has ${count} school(s). Restore only into an empty project.`); process.exit(1); }
  const read = (name) => parse(readFileSync(join(arg1, `${name}.ndjson.gz`)));

  console.log("Recreating logins…");
  for (const u of read("auth_users")) {
    const { error } = await db.auth.admin.createUser({ id: u.id, email: u.email, email_confirm: true, password: randomBytes(24).toString("base64url") + "aA1" });
    if (error && !/already/i.test(error.message)) { console.error(`login ${u.email}: ${error.message}`); process.exit(1); }
  }
  // A login can point at a staff profile (users.staff_id), but logins are restored before staff:
  // insert them without it, then set it once staff exist.
  const staffLinks = [];
  for (const name of TABLES) {
    if (!existsSync(join(arg1, `${name}.ndjson.gz`))) { console.log(`skipped  ${name.padEnd(18)} (not in this backup)`); continue; }
    let rows = read(name);
    const skip = [...(SKIP_COLUMNS[name] ?? []), ...(name === "users" ? ["staff_id"] : [])];
    if (name === "users") for (const r of rows) if (r.staff_id) staffLinks.push({ id: r.id, staff_id: r.staff_id });
    if (skip.length) rows = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !skip.includes(k))));
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      // New schools get default settings from triggers; the backup's own settings replace them.
      const q = UPSERT[name] ? db.from(name).upsert(chunk, { onConflict: UPSERT[name] }) : db.from(name).insert(chunk);
      const { error } = IDENTITY.has(name) ? await db.rpc("restore_identity_rows", { p_table: name, p_rows: chunk }) : await q;
      if (error) { console.error(`${name}: ${error.message}`); process.exit(1); }
    }
    console.log(`restored ${name.padEnd(18)} ${rows.length}`);
    if (name === "staff" && staffLinks.length) {
      for (const l of staffLinks) {
        const { error } = await db.from("users").update({ staff_id: l.staff_id }).eq("id", l.id);
        if (error) { console.error(`users.staff_id: ${error.message}`); process.exit(1); }
      }
      console.log(`relinked ${"logins to staff".padEnd(18)} ${staffLinks.length}`);
    }
  }
  console.log("The school portal key is not in backups: paste it again in Settings → School portal.");
  console.log("Done. Everyone must now use \"Forgot password?\" to set a password. Photos are not part of the backup.");
} else {
  console.log("Usage: list | check <day> | download <day> <folder> | restore <folder>");
  process.exit(1);
}
