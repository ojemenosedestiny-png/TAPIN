import { describe, expect, it } from "vitest";
import { BACKUP_TABLES, backupsToPrune, toNdjson } from "@/lib/backup";

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
});
