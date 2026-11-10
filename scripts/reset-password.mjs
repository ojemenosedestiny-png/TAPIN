// Sets a new password for an existing TapIn login (for when someone is locked out).
//   node --env-file=.env.local scripts/reset-password.mjs you@example.com
// You will be asked for the new password (input is not hidden — run it somewhere private).
import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";

const [emailArg] = process.argv.slice(2);
if (!emailArg) {
  console.error("Usage: node --env-file=.env.local scripts/reset-password.mjs <email>");
  process.exit(1);
}
const email = emailArg.trim().toLowerCase();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (use --env-file=.env.local).");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: profile } = await db.from("users").select("id, name, role").eq("email", email).maybeSingle();
if (!profile) {
  console.error(`No TapIn login found for ${email}.`);
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = (await rl.question(`New password for ${email} (min 10 chars, upper, lower, number): `)).trim();
const again = (await rl.question("Type it again: ")).trim();
rl.close();
if (password !== again) {
  console.error("The two passwords don't match. Nothing was changed.");
  process.exit(1);
}
if (password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
  console.error("Password is too weak. Nothing was changed.");
  process.exit(1);
}

const { error } = await db.auth.admin.updateUserById(profile.id, { password });
if (error) {
  console.error("Could not change the password:", error.message);
  process.exit(1);
}
await db.from("audit_logs").insert({ actor_id: profile.id, action: "user.password_reset", entity: "users", entity_id: profile.id, details: { via: "script" } });
console.log(`Password changed for ${email}. Sign in at /login with the new password.`);
