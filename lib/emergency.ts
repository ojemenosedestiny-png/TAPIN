/**
 * Emergency roll call (spec 9). Pure helpers, unit tested.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export type RollPerson = { id: string; holder_type: "student" | "staff"; holder_id: string; name: string; group_name: string; on_roster: boolean; safe_at: string | null; marked_by: string | null };
export type RollGroup = { name: string; people: RollPerson[]; safe: number; total: number };
export type RollCounts = { total: number; safe: number; missing: number };

/** 4 to 6 digits. */
export function validPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{4,6}$/.test(pin);
}

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(pin, salt, 32).toString("hex")}`;
}

export function checkPin(pin: string, stored: string | null | undefined): boolean {
  if (!stored || !validPin(pin)) return false;
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, "hex");
  const got = scryptSync(pin, Buffer.from(saltHex, "hex"), want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}

export function rollCounts(people: readonly Pick<RollPerson, "safe_at">[]): RollCounts {
  const safe = people.filter((p) => p.safe_at).length;
  return { total: people.length, safe, missing: people.length - safe };
}

/** Classes first (alphabetical), staff last; within a group, missing people first. */
export function groupRoll(people: readonly RollPerson[]): RollGroup[] {
  const by = new Map<string, RollPerson[]>();
  for (const p of people) by.set(p.group_name, [...(by.get(p.group_name) ?? []), p]);
  return [...by.entries()]
    .sort(([a], [b]) => (a === "Staff" ? 1 : b === "Staff" ? -1 : a.localeCompare(b, undefined, { numeric: true })))
    .map(([name, list]) => ({
      name,
      people: [...list].sort((x, y) => Number(!!x.safe_at) - Number(!!y.safe_at) || x.name.localeCompare(y.name)),
      ...(({ safe, total }) => ({ safe, total }))(rollCounts(list)),
    }));
}

export function defaultBroadcast(kind: "real" | "drill", school: string): string {
  return kind === "drill"
    ? `${school}: we held an emergency drill today. All children took part safely. No action is needed.`
    : `${school}: there was an emergency at school today. Your child is safe and accounted for. We will share more information soon.`;
}

/** "12 min" / "1h 05m" between two instants. */
export function duration(from: string, to: string): string {
  const min = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
}
