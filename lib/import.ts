import { z } from "zod";
import { normaliseNgPhone } from "@/lib/phone";

/** Columns of the student import template, in order. */
export const IMPORT_COLUMNS = [
  { key: "admission_no", label: "Admission No", example: "STU0012", required: true },
  { key: "first_name", label: "First Name", example: "Chioma", required: true },
  { key: "last_name", label: "Last Name", example: "Okafor", required: true },
  { key: "class", label: "Class", example: "JSS2A", required: true },
  { key: "guardian_name", label: "Guardian Name", example: "Ngozi Okafor", required: false },
  { key: "guardian_phone", label: "Guardian Phone", example: "08031234567", required: false },
  { key: "guardian_relationship", label: "Relationship", example: "Mother", required: false },
  { key: "guardian2_name", label: "Guardian 2 Name", example: "", required: false },
  { key: "guardian2_phone", label: "Guardian 2 Phone", example: "", required: false },
  { key: "guardian2_relationship", label: "Guardian 2 Relationship", example: "", required: false },
  { key: "consent", label: "Consent Received", example: "Yes", required: false },
] as const;

export type ImportKey = (typeof IMPORT_COLUMNS)[number]["key"];
export const MAX_IMPORT_ROWS = 3000;

/** Matches a sheet header to a column key: case, spaces, dots and underscores don't matter. */
export function headerToKey(header: string): ImportKey | null {
  const norm = header.toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliases: Record<string, ImportKey> = {
    admissionno: "admission_no", admissionnumber: "admission_no", admno: "admission_no", regno: "admission_no",
    firstname: "first_name", givenname: "first_name",
    lastname: "last_name", surname: "last_name",
    class: "class", classname: "class", arm: "class",
    guardianname: "guardian_name", parentname: "guardian_name", guardian1name: "guardian_name",
    guardianphone: "guardian_phone", parentphone: "guardian_phone", phone: "guardian_phone", guardian1phone: "guardian_phone",
    relationship: "guardian_relationship", guardianrelationship: "guardian_relationship", guardian1relationship: "guardian_relationship",
    guardian2name: "guardian2_name", guardian2phone: "guardian2_phone", guardian2relationship: "guardian2_relationship",
    consent: "consent", consentreceived: "consent", parentalconsent: "consent",
  };
  return aliases[norm] ?? null;
}

const text = (max: number) => z.string().trim().max(max);

export const importGuardianSchema = z.object({
  name: text(120).min(1),
  phone: z.string().regex(/^\+234\d{10}$/),
  relationship: text(40).optional(),
});

export const importRowSchema = z.object({
  row: z.number().int().positive(),
  admission_no: text(40).min(1),
  first_name: text(60).min(1),
  last_name: text(60).min(1),
  class: text(40).min(1),
  guardians: z.array(importGuardianSchema).max(2),
  consent: z.boolean(),
});
export type ImportRow = z.infer<typeof importRowSchema>;

export type RowIssue = { row: number; message: string };
export type ImportValidation = { rows: ImportRow[]; issues: RowIssue[] };

/**
 * Validates raw sheet rows (already keyed by column). Returns the clean rows and a list
 * of problems by spreadsheet row number. Rows with problems are left out.
 */
export function validateImportRows(raw: { row: number; values: Partial<Record<ImportKey, string>> }[]): ImportValidation {
  const rows: ImportRow[] = [];
  const issues: RowIssue[] = [];
  const seenAdmission = new Map<string, number>();

  for (const { row, values: v } of raw) {
    const blank = Object.values(v).every((x) => !x || !String(x).trim());
    if (blank) continue;

    const problems: string[] = [];
    const admission = (v.admission_no ?? "").trim().toUpperCase();
    const first = (v.first_name ?? "").trim();
    const last = (v.last_name ?? "").trim();
    const cls = (v.class ?? "").trim().toUpperCase().replace(/\s+/g, "");
    if (!admission) problems.push("Admission No is missing");
    if (!first) problems.push("First Name is missing");
    if (!last) problems.push("Last Name is missing");
    if (!cls) problems.push("Class is missing");

    if (admission) {
      const dup = seenAdmission.get(admission);
      if (dup) problems.push(`Admission No ${admission} also appears on row ${dup}`);
      else seenAdmission.set(admission, row);
    }

    const guardians: ImportRow["guardians"] = [];
    for (const [n, p, r, label] of [
      [v.guardian_name, v.guardian_phone, v.guardian_relationship, "Guardian"],
      [v.guardian2_name, v.guardian2_phone, v.guardian2_relationship, "Guardian 2"],
    ] as const) {
      const name = (n ?? "").trim();
      const phoneRaw = (p ?? "").trim();
      if (!name && !phoneRaw) continue;
      if (!name) { problems.push(`${label} name is missing`); continue; }
      const phone = normaliseNgPhone(phoneRaw);
      if (!phone) { problems.push(`${label} phone "${phoneRaw}" is not a valid Nigerian mobile number`); continue; }
      guardians.push({ name, phone, relationship: (r ?? "").trim() || undefined });
    }

    if (problems.length) {
      issues.push({ row, message: problems.join("; ") });
      continue;
    }
    const consent = /^(y|yes|true|1|received|signed)$/i.test((v.consent ?? "").trim());
    const parsed = importRowSchema.safeParse({ row, admission_no: admission, first_name: first, last_name: last, class: cls, guardians, consent });
    if (!parsed.success) {
      issues.push({ row, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      continue;
    }
    rows.push(parsed.data);
  }
  return { rows, issues };
}
