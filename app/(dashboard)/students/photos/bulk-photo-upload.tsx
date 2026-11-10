"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Images, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { PHOTO_BUCKET, photoPath } from "@/lib/photos";
import { admissionFromFilename, centerSquare, loadImage, renderPhoto } from "@/lib/image";
import { lookupAdmissions, setPhotosByAdmission } from "@/app/(dashboard)/_actions/photos";

type Item = { file: File; admission: string; state: "waiting" | "uploading" | "done" | "failed"; note?: string };

export function BulkPhotoUpload({ schoolId }: { schoolId: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);

  const patch = (i: number, p: Partial<Item>) => setItems((list) => list.map((it, j) => (j === i ? { ...it, ...p } : it)));

  const choose = (files: FileList | null) => {
    if (!files) return;
    setItems(
      [...files]
        .filter((f) => f.type.startsWith("image/"))
        .slice(0, 500)
        .map((file) => ({ file, admission: admissionFromFilename(file.name), state: "waiting" })),
    );
  };

  const run = async () => {
    setRunning(true);
    const supabase = createClient();
    const ids = await lookupAdmissions(items.map((i) => i.admission));
    const uploaded: { index: number; admission_no: string; path: string }[] = [];

    // Upload a few at a time.
    const queue = items.map((it, index) => ({ it, index }));
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const { it, index } = next;
        const id = ids[it.admission];
        if (!id) { patch(index, { state: "failed", note: "No student with this admission number" }); continue; }
        patch(index, { state: "uploading" });
        try {
          const img = await loadImage(it.file);
          const blob = await renderPhoto(img, centerSquare(img.naturalWidth, img.naturalHeight));
          const path = photoPath(schoolId, "student", id);
          const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg" });
          if (error) throw new Error("Upload failed");
          uploaded.push({ index, admission_no: it.admission, path });
        } catch (e) {
          patch(index, { state: "failed", note: (e as Error).message || "Couldn't process this image" });
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);

    if (uploaded.length) {
      const res = await setPhotosByAdmission(uploaded.map(({ admission_no, path }) => ({ admission_no, path })));
      const saved = new Set(res.saved);
      const noConsent = new Set(res.noConsent ?? []);
      for (const u of uploaded) patch(u.index, saved.has(u.admission_no) ? { state: "done" } : { state: "failed", note: noConsent.has(u.admission_no) ? "No parental consent recorded" : "Could not save" });
      toast.success(`${res.saved.length} photo${res.saved.length === 1 ? "" : "s"} saved.`);
    }
    setRunning(false);
  };

  const done = items.filter((i) => i.state === "done").length;
  const failed = items.filter((i) => i.state === "failed").length;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center shadow-sm">
        <label htmlFor="bulk-photos" className="flex cursor-pointer flex-col items-center gap-2">
          <Images className="size-10 text-brand" aria-hidden />
          <span className="font-medium text-ink">{items.length ? `${items.length} photos selected` : "Choose photos"}</span>
          <span className="text-sm text-muted-foreground">JPEG or PNG, up to 500 at a time.</span>
        </label>
        <input id="bulk-photos" type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={running} onChange={(e) => choose(e.target.files)} />
        {items.length > 0 && (
          <Button className="mt-4" onClick={run} disabled={running || done === items.length}>
            {running ? `Uploading… ${done + failed}/${items.length}` : `Upload ${items.length} photos`}
          </Button>
        )}
      </div>

      {items.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm shadow-sm" aria-live="polite">
          {items.map((it, i) => (
            <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="truncate"><span className="font-medium tabular-nums text-ink">{it.admission}</span> <span className="text-muted-foreground">· {it.file.name}</span></span>
              <span className="flex shrink-0 items-center gap-1.5 text-xs">
                {it.state === "done" && <><CheckCircle2 className="size-4 text-success" aria-hidden /> Saved</>}
                {it.state === "failed" && <><XCircle className="size-4 text-danger" aria-hidden /> <span className="text-red-800">{it.note}</span></>}
                {it.state === "uploading" && <span className="text-muted-foreground">Uploading…</span>}
                {it.state === "waiting" && <span className="text-muted-foreground">Waiting</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
