"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/dashboard/status-pill";
import { formatNgPhone } from "@/lib/phone";
import { commitImport, previewImport, type CommitResult, type PreviewResult } from "./actions";

export function ImportFlow() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Extract<PreviewResult, { ok: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<CommitResult, { ok: true }> | null>(null);
  const [pending, start] = useTransition();

  const check = () => {
    if (!file) return;
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("file", file);
      try {
        const r = await previewImport(fd);
        if (r.ok) setPreview(r);
        else setError(r.error);
      } catch {
        setError("Could not read the file. Please try again.");
      }
    });
  };

  const save = () => {
    if (!preview) return;
    start(async () => {
      try {
        const r = await commitImport(preview.rows);
        if (r.ok) {
          setDone(r);
          toast.success("Import complete.");
        } else setError(r.error);
      } catch {
        setError("The import failed part-way. It's safe to run it again — students are matched by admission number.");
      }
    });
  };

  if (done) {
    return (
      <div className="surface rounded-xl p-8 text-center shadow-sm">
        <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden />
        <h2 className="mt-3 text-xl font-semibold text-ink">Import complete</h2>
        <p className="mt-2 text-sm text-muted-foreground tabular-nums">
          {done.created} added · {done.updated} updated · {done.guardians} new guardians · {done.classes} new classes
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button asChild variant="outline"><Link href="/students/photos">Upload photos</Link></Button>
          <Button asChild><Link href="/students">View students</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-dashed border-border bg-card p-6 shadow-sm">
        <label htmlFor="import-file" className="flex cursor-pointer flex-col items-center gap-2 text-center">
          <FileSpreadsheet className="size-10 text-brand" aria-hidden />
          <span className="font-medium text-ink">{file ? file.name : "Choose an Excel file (.xlsx)"}</span>
          <span className="text-sm text-muted-foreground">Headers in row 1, one student per row.</span>
        </label>
        <input id="import-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setError(null); }} />
        <div className="mt-4 flex justify-center">
          <Button onClick={check} disabled={!file || pending}><Upload className="size-4" /> {pending && !preview ? "Checking…" : "Check file"}</Button>
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

      {preview && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <StatusPill tone="green">{preview.rows.length - preview.existingAdmissions.length} new</StatusPill>
            {preview.existingAdmissions.length > 0 && <StatusPill tone="teal">{preview.existingAdmissions.length} will be updated</StatusPill>}
            {preview.issues.length > 0 && <StatusPill tone="red">{preview.issues.length} rows with problems</StatusPill>}
            {preview.newClasses.length > 0 && <StatusPill tone="amber">New classes: {preview.newClasses.join(", ")}</StatusPill>}
          </div>

          {preview.unknownHeaders.length > 0 && (
            <p className="text-sm text-muted-foreground">Ignored columns: {preview.unknownHeaders.join(", ")}</p>
          )}

          {preview.issues.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50/60 p-4">
              <p className="flex items-center gap-2 font-medium text-red-900"><AlertTriangle className="size-4" aria-hidden /> These rows will be skipped. Fix them in Excel and import again.</p>
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-sm text-red-900">
                {preview.issues.map((i) => <li key={i.row}><span className="font-medium tabular-nums">Row {i.row}:</span> {i.message}</li>)}
              </ul>
            </div>
          )}

          {preview.rows.length > 0 && (
            <div className="overflow-x-auto surface rounded-xl">
              <table className="w-full min-w-[640px] text-sm">
                <caption className="sr-only">Students to import</caption>
                <thead className="bg-muted/60 text-left text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Row</th>
                    <th scope="col" className="px-3 py-2 font-medium">Admission no.</th>
                    <th scope="col" className="px-3 py-2 font-medium">Name</th>
                    <th scope="col" className="px-3 py-2 font-medium">Class</th>
                    <th scope="col" className="px-3 py-2 font-medium">Guardians</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 200).map((r) => (
                    <tr key={r.row} className="border-t border-border">
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.row}</td>
                      <td className="px-3 py-2 tabular-nums">{r.admission_no}</td>
                      <td className="px-3 py-2 text-ink">{r.first_name} {r.last_name}</td>
                      <td className="px-3 py-2">{r.class}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.guardians.map((g) => `${g.name} (${formatNgPhone(g.phone)})`).join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > 200 && <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">…and {preview.rows.length - 200} more</p>}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPreview(null)} disabled={pending}>Cancel</Button>
            <Button onClick={save} disabled={pending || preview.rows.length === 0}>
              {pending ? "Importing…" : `Import ${preview.rows.length} student${preview.rows.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
