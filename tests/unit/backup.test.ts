import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { BACKUP_TABLES, RESTORE_SKIP_COLUMNS, RESTORE_UPSERT, backupsToPrune, toNdjson } from "@/lib/backup";

describe("backups", () => {
  it("keeps the newest 14 days and prunes the rest, ignoring stray files", () => {
    const days = Array.from({ length: 20 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);
    const prune = backupsToPrune([...days, "notes.txt", ".emptyFolderPlaceholder"]);
    expect(prune).toHaveLength(6);
    expect(prune.sort()[0]).toBe("2026-11-01");
    expect(prune).not.toContain("2026-11-20");
    expect(backupsToPrune(days.slice(0, 3))).toEqual([]);
  });

  it("writes one JSON object per line", () => {
    expect(toNdjson([{ a: 1 }, { b: "x\ny" }])).toBe('{"a":1}\n{"b":"x\\ny"}\n');
    expect(toNdjson([])).toBe("");
  });

  it("backs up parents before children so a restore's foreign keys resolve", () => {
    const order: string[] = BACKUP_TABLES.map((t) => t.name);
    const before = (a: string, b: string) => expect(order.indexOf(a)).toBeLessThan(order.indexOf(b));
    before("schools", "users");
    before("users", "classes"); // class_teacher_id
    before("classes", "students");
    before("students", "student_guardians");
    before("guardians", "student_guardians");
    before("devices", "attendance");
    before("students", "excusals");
    before("guardians", "sms_logs");
  });

  it("the restore script restores the same tables, in the same order, as the nightly backup saves", () => {
    const script = readFileSync("scripts/backup.mjs", "utf8");
    const between = (start: string, end: string) => {
      const from = script.indexOf(start) + start.length;
      return script.slice(from, script.indexOf(end, from) + 1);
    };
    const tables = JSON.parse(between("const TABLES = ", "]"));
    const asJson = (s: string) => JSON.parse(s.replace(/([a-z_]+):/g, '"$1":'));
    expect(tables).toEqual(BACKUP_TABLES.map((t) => t.name));
    expect(asJson(between("const SKIP_COLUMNS = ", "}"))).toEqual(RESTORE_SKIP_COLUMNS);
    expect(asJson(between("const UPSERT = ", "}"))).toEqual(RESTORE_UPSERT);
  });

  it("backs up every table, except the short-lived ones and the one holding the portal key", () => {
    const dir = "supabase/migrations";
    const sql = readdirSync(dir).sort().map((f) => readFileSync(`${dir}/${f}`, "utf8")).join("\n");
    const created = [...new Set([...sql.matchAll(/create table (?:if not exists )?public\.([a-z_]+)/gi)].map((m) => m[1]!))];
    const leftOut = new Set(["rate_limits", "report_links", "portal_deliveries", "portal_links"]);
    expect(created.filter((t) => !leftOut.has(t) && !BACKUP_TABLES.some((b) => b.name === t))).toEqual([]);
  });
});
