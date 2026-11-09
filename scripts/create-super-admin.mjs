// Creates the first super admin login. Run once per environment:
//   node --env-file=.env.local scripts/create-super-admin.mjs you@example.com "Your Name"
// You will be asked for a password (input is not hidden — run it somewhere private).
import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";

const [email, name] = process.argv.slice(2);
if (!email || !name) {
  console.error('Usage: node --env-file=.env.local scripts/create-super-admin.mjs <email> "<name>"');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (use --env-file=.env.local).");
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question("Password (min 10 chars, upper, lower, number): ");
rl.close();
if (password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
  console.error("Password is too weak.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await db.auth.admin.createUser({ email: email.toLowerCase(), password, email_confirm: true });
if (error) {
  console.error("Could not create login:", error.message);
  process.exit(1);
}
const { error: profileError } = await db
  .from("users")
  .insert({ id: data.user.id, email: email.toLowerCase(), name, role: "super_admin", school_id: null });
if (profileError) {
  await db.auth.admin.deleteUser(data.user.id);
  console.error("Could not create profile:", profileError.message);
  process.exit(1);
}
await db.from("audit_logs").insert({ actor_id: data.user.id, action: "user.create", entity: "users", entity_id: data.user.id, details: { role: "super_admin", via: "script" } });
console.log(`Super admin ${email} created. Sign in at /login.`);
