import { describe, expect, it } from "vitest";
import { headerToKey, validateImportRows } from "@/lib/import";

const row = (n: number, v: Record<string, string>) => ({ row: n, values: v });

describe("import headers", () => {
  it("matches headers regardless of case and punctuation", () => {
    expect(headerToKey("Admission No")).toBe("admission_no");
    expect(headerToKey("ADMISSION_NUMBER")).toBe("admission_no");
    expect(headerToKey("Surname")).toBe("last_name");
    expect(headerToKey("first name")).toBe("first_name");
    expect(headerToKey("Parent Phone")).toBe("guardian_phone");
    expect(headerToKey("Guardian 2 Phone")).toBe("guardian2_phone");
    expect(headerToKey("Favourite colour")).toBeNull();
  });
});

describe("import validation", () => {
  it("cleans valid rows: uppercase admission and class, phone to +234", () => {
    const { rows, issues } = validateImportRows([
      row(2, { admission_no: "stu0012", first_name: " Chioma ", last_name: "Okafor", class: "jss 2a", guardian_name: "Ngozi Okafor", guardian_phone: "08031234567", guardian_relationship: "Mother" }),
    ]);
    expect(issues).toEqual([]);
    expect(rows[0]).toEqual({
      row: 2, admission_no: "STU0012", first_name: "Chioma", last_name: "Okafor", class: "JSS2A",
      guardians: [{ name: "Ngozi Okafor", phone: "+2348031234567", relationship: "Mother" }],
      consent: false,
    });
  });

  it("reads the optional Consent column (Yes / Y / true / signed)", () => {
    const base = { admission_no: "A1", first_name: "A", last_name: "B", class: "JSS1A" };
    const { rows } = validateImportRows([
      row(2, { ...base, consent: "Yes" }), row(3, { ...base, admission_no: "A2", consent: "y" }),
      row(4, { ...base, admission_no: "A3", consent: "No" }), row(5, { ...base, admission_no: "A4" }),
    ]);
    expect(rows.map((r) => r.consent)).toEqual([true, true, false, false]);
  });

  it("allows students with no guardian, and two guardians", () => {
    const { rows } = validateImportRows([
      row(2, { admission_no: "A1", first_name: "A", last_name: "B", class: "JSS1A" }),
      row(3, { admission_no: "A2", first_name: "C", last_name: "D", class: "JSS1A", guardian_name: "M", guardian_phone: "08031234567", guardian2_name: "F", guardian2_phone: "8051234567" }),
    ]);
    expect(rows[0]!.guardians).toEqual([]);
    expect(rows[1]!.guardians.map((g) => g.phone)).toEqual(["+2348031234567", "+2348051234567"]);
  });

  it("skips blank rows silently", () => {
    const { rows, issues } = validateImportRows([row(5, { admission_no: "", first_name: " " })]);
    expect(rows).toEqual([]);
    expect(issues).toEqual([]);
  });

  it("reports missing fields, bad phones and duplicates by row number", () => {
    const { rows, issues } = validateImportRows([
      row(2, { admission_no: "A1", first_name: "A", last_name: "", class: "JSS1A" }),
      row(3, { admission_no: "A2", first_name: "B", last_name: "C", class: "JSS1A", guardian_name: "M", guardian_phone: "12345" }),
      row(4, { admission_no: "A3", first_name: "B", last_name: "C", class: "JSS1A", guardian_phone: "08031234567" }),
      row(5, { admission_no: "A5", first_name: "E", last_name: "F", class: "JSS1A" }),
      row(6, { admission_no: "a5", first_name: "G", last_name: "H", class: "JSS1A" }),
    ]);
    expect(rows.map((r) => r.admission_no)).toEqual(["A5"]);
    expect(issues.map((i) => i.row)).toEqual([2, 3, 4, 6]);
    expect(issues[0]!.message).toMatch(/Last Name is missing/);
    expect(issues[1]!.message).toMatch(/not a valid Nigerian mobile/);
    expect(issues[2]!.message).toMatch(/Guardian name is missing/);
    expect(issues[3]!.message).toMatch(/also appears on row 5/);
  });
});
