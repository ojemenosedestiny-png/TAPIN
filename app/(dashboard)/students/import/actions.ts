"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { readImportWorkbook } from "@/lib/excel";
import { importRowSchema, validateImportRows, MAX_IMPORT_ROWS, type ImportRow, type RowIssue } from "@/lib/import";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export type PreviewResult =
  | { ok: true; rows: ImportRow[]; issues: RowIssue[]; unknownHeaders: string[]; newClasses: string[]; existingAdmissions: string[] }
  | { ok: false; error: string };

async function adminOnly() {
  const user = await requireSchoolArea("students");
  if (user.role !== "school_admin") throw new Error("Only school admins can import students.");
  return user;
}

/** Step 1: read the workbook and report what would happen. Nothing is saved. */
export async function previewImport(formData: FormData): Promise<PreviewResult> {
  await adminOnly();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an Excel file." };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "File is too large (max 5 MB)." };
  if (!/\.xlsx$/i.test(file.name)) return { ok: false, error: "Use an .xlsx file. In Excel: File → Save As → Excel Workbook (.xlsx)." };

  const sheet = await readImportWorkbook(await file.arrayBuffer());
  if (!sheet.ok) return sheet;
  const { rows, issues } = validateImportRows(sheet.rows);
  if (!rows.length && !issues.length) return { ok: false, error: "No students found in the sheet." };

  const supabase = await createClient();
  const [{ data: classes }, { data: existing }] = await Promise.all([
    supabase.from("classes").select("name"),
    supabase.from("students").select("admission_no").in("admission_no", rows.map((r) => r.admission_no)),
  ]);
  const known = new Set((classes ?? []).map((c) => c.name.toUpperCase()));
  const newClasses = [...new Set(rows.map((r) => r.class))].filter((c) => !known.has(c)).sort();

  return {
    ok: true, rows, issues, unknownHeaders: sheet.unknownHeaders, newClasses,
    existingAdmissions: (existing ?? []).map((e) => e.admission_no),
  };
}

const commitSchema = z.array(importRowSchema).min(1).max(MAX_IMPORT_ROWS);

export type CommitResult = { ok: true; created: number; updated: number; guardians: number; classes: number } | { ok: false; error: string };

/**
 * Step 2: save. Creates missing classes, upserts students by admission number,
 * reuses guardians by phone number, links guardians to students.
 */
export async function commitImport(rowsInput: ImportRow[]): Promise<CommitResult> {
  const user = await adminOnly();
  const parsed = commitSchema.safeParse(rowsInput);
  if (!parsed.success) return { ok: false, error: "The import data is invalid. Upload the file again." };
  const rows = parsed.data;
  const supabase = await createClient();

  // 1. Classes
  const { data: existingClasses } = await supabase.from("classes").select("id, name");
  const classId = new Map((existingClasses ?? []).map((c) => [c.name.toUpperCase(), c.id]));
  const missing = [...new Set(rows.map((r) => r.class))].filter((c) => !classId.has(c));
  if (missing.length) {
    const { data, error } = await supabase.from("classes").insert(missing.map((name) => ({ school_id: user.schoolId, name }))).select("id, name");
    if (error) return { ok: false, error: "Could not create classes." };
    for (const c of data ?? []) classId.set(c.name.toUpperCase(), c.id);
  }

  // 2. Students (upsert by admission number)
  const { data: before } = await supabase.from("students").select("admission_no").in("admission_no", rows.map((r) => r.admission_no));
  const existed = new Set((before ?? []).map((s) => s.admission_no));
  const { data: students, error: stuErr } = await supabase
    .from("students")
    .upsert(
      rows.map((r) => ({
        school_id: user.schoolId, admission_no: r.admission_no, first_name: r.first_name, last_name: r.last_name,
        class_id: classId.get(r.class) ?? null, status: "active",
      })),
      { onConflict: "school_id,admission_no" },
    )
    .select("id, admission_no");
  if (stuErr) return { ok: false, error: "Could not save students. Nothing after the classes step was saved." };
  const studentId = new Map((students ?? []).map((s) => [s.admission_no, s.id]));

  const consentIds = rows.filter((r) => r.consent).map((r) => studentId.get(r.admission_no)).filter((x): x is string => !!x);
  if (consentIds.length) {
    await supabase.from("students").update({ consent_at: new Date().toISOString(), consent_note: "Recorded in Excel import", consent_recorded_by: user.id })
      .in("id", consentIds).is("consent_at", null);
  }

  // 3. Guardians (dedupe by phone within the school)
  const allGuardians = rows.flatMap((r) => r.guardians);
  const phones = [...new Set(allGuardians.map((g) => g.phone))];
  let guardiansCreated = 0;
  const guardianId = new Map<string, string>();
  if (phones.length) {
    const { data: known } = await supabase.from("guardians").select("id, phone").in("phone", phones);
    for (const g of known ?? []) guardianId.set(g.phone, g.id);
    const toCreate = phones.filter((p) => !guardianId.has(p)).map((p) => {
      const g = allGuardians.find((x) => x.phone === p)!;
      return { school_id: user.schoolId, name: g.name, phone: p, relationship: g.relationship ?? null };
    });
    if (toCreate.length) {
      const { data, error } = await supabase.from("guardians").insert(toCreate).select("id, phone");
      if (error) return { ok: false, error: "Students were saved, but guardians could not be. Run the import again to retry." };
      for (const g of data ?? []) guardianId.set(g.phone, g.id);
      guardiansCreated = data?.length ?? 0;
    }

    const links = rows.flatMap((r) =>
      r.guardians.map((g) => ({ school_id: user.schoolId, student_id: studentId.get(r.admission_no)!, guardian_id: guardianId.get(g.phone)! })),
    ).filter((l) => l.student_id && l.guardian_id);
    if (links.length) {
      const { error } = await supabase.from("student_guardians").upsert(links, { onConflict: "student_id,guardian_id", ignoreDuplicates: true });
      if (error) return { ok: false, error: "Students were saved, but guardian links could not be. Run the import again to retry." };
    }
  }

  const created = rows.filter((r) => !existed.has(r.admission_no)).length;
  const result = { created, updated: rows.length - created, guardians: guardiansCreated, classes: missing.length };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "student.import", entity: "students", details: result });
  revalidatePath("/students");
  revalidatePath("/classes");
  return { ok: true, ...result };
}
