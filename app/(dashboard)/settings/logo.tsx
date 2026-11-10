"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { createClient } from "@/lib/supabase/client";
import { PHOTO_BUCKET } from "@/lib/photos";
import { loadImage } from "@/lib/image";
import { setSchoolLogo } from "./school-actions";

/** School logo for the kiosk and ID cards: any image, scaled to at most 512 px, saved as PNG (keeps transparency). */
export function LogoUpload({ schoolId, logoUrl }: { schoolId: string; logoUrl: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Choose an image file (PNG or JPEG).");
    setBusy(true);
    try {
      const img = await loadImage(file);
      const scale = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!blob || blob.size > 200 * 1024) throw new Error("That logo is too detailed to fit in 200 KB. Try a simpler or smaller image.");
      const path = `${schoolId}/logo-${Date.now()}.png`;
      const supabase = createClient();
      const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: "image/png" });
      if (error) throw new Error("Upload failed. Check your connection and try again.");
      const res = await setSchoolLogo(path);
      if (!res.ok) {
        await supabase.storage.from(PHOTO_BUCKET).remove([path]);
        throw new Error(res.error);
      }
      toast.success("Logo saved. It shows on the kiosk and on ID cards.");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <span className="flex size-16 items-center justify-center overflow-hidden rounded-xl border border-border bg-white">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="School logo" className="size-full object-contain p-1" />
        ) : (
          <Logo className="size-10 opacity-40" title="No logo yet" />
        )}
      </span>
      <div>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
          <ImagePlus className="size-4" /> {busy ? "Uploading…" : logoUrl ? "Change logo" : "Upload logo"}
        </Button>
        <p className="mt-1 text-xs text-muted-foreground">PNG with a transparent background looks best.</p>
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden
        onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}
