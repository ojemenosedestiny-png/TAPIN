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

const TABLES = ["schools", "users", "classes", "students", "guardians", "student_guardians", "staff", "cards", "devices",
  "alert_settings", "school_calendar", "attendance", "excusals", "tap_events", "sms_logs", "notifications", "audit_logs"];
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
    const { data, error: e } = await bucket.download(`${day}/${name}.ndjson.gz`);
    if (e) throw new Error(`Missing ${name}: ${e.message}`);
    files[name] = Buffer.from(await data.arrayBuffer());
  }
  return { manifest, files };
}

function verify(manifest, files) {
  let ok = true;
  for (const name of TABLES) {
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
  for (const name of TABLES) {
    // New schools get default alert settings from a trigger; the backup's own settings replace them.
    const rows = read(name);
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const q = name === "alert_settings" ? db.from(name).upsert(chunk, { onConflict: "school_id" }) : db.from(name).insert(chunk);
      const { error } = IDENTITY.has(name) ? await db.rpc("restore_identity_rows", { p_table: name, p_rows: chunk }) : await q;
      if (error) { console.error(`${name}: ${error.message}`); process.exit(1); }
    }
    console.log(`restored ${name.padEnd(18)} ${rows.length}`);
  }
  console.log("Done. Everyone must now use \"Forgot password?\" to set a password. Photos are not part of the backup.");
} else {
  console.log("Usage: list | check <day> | download <day> <folder> | restore <folder>");
  process.exit(1);
}
