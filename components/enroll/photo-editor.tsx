"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PersonAvatar } from "@/components/dashboard/person-avatar";
import { createClient } from "@/lib/supabase/client";
import { PHOTO_BUCKET, photoPath } from "@/lib/photos";
import { cropFor, loadImage, renderPhoto } from "@/lib/image";
import { setPhoto } from "@/app/(dashboard)/_actions/photos";

type Props = {
  schoolId: string;
  holderType: "student" | "staff" | "pickup";
  holderId: string;
  name: string;
  photoUrl: string | null;
};

/** Photo with "Take photo" (camera) and "Upload" — both go through a square crop before upload. */
export function PhotoEditor({ schoolId, holderType, holderId, name, photoUrl }: Props) {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Choose an image file.");
    try {
      setImg(await loadImage(file));
    } catch {
      toast.error("Couldn't open that image. Try a JPEG or PNG.");
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <PersonAvatar name={name} src={photoUrl} size="xl" />
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => cameraRef.current?.click()}>
          <Camera className="size-4" /> Take photo
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          <ImagePlus className="size-4" /> Upload
        </Button>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="user" className="sr-only" tabIndex={-1} aria-hidden
        onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden
        onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
      {img && (
        <CropDialog
          img={img}
          onCancel={() => setImg(null)}
          onSave={async (blob) => {
            const path = photoPath(schoolId, holderType, holderId);
            const supabase = createClient();
            const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
            if (error) throw new Error("Upload failed. Check your connection and try again.");
            const res = await setPhoto({ holder_type: holderType, holder_id: holderId, path });
            if (!res.ok) {
              await supabase.storage.from(PHOTO_BUCKET).remove([path]);
              throw new Error(res.error);
            }
            toast.success("Photo saved.");
            setImg(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function CropDialog({ img, onCancel, onSave }: { img: HTMLImageElement; onCancel: () => void; onSave: (b: Blob) => Promise<void> }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; pan: { x: number; y: number } } | null>(null);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const crop = cropFor(W, H, zoom, pan.x, pan.y);

  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, crop.x, crop.y, crop.size, crop.size, 0, 0, c.width, c.height);
  }, [img, crop.x, crop.y, crop.size]);

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const scale = crop.size / box.width; // source px per screen px
    const dx = ((e.clientX - drag.current.x) * scale) / Math.max(1, (W - crop.size) / 2);
    const dy = ((e.clientY - drag.current.y) * scale) / Math.max(1, (H - crop.size) / 2);
    setPan({ x: Math.max(-1, Math.min(1, drag.current.pan.x - dx)), y: Math.max(-1, Math.min(1, drag.current.pan.y - dy)) });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Crop photo</DialogTitle>
          <DialogDescription>Drag to centre the face in the circle. Use the slider to zoom.</DialogDescription>
        </DialogHeader>
        <div
          className="relative mx-auto aspect-square w-full max-w-72 cursor-grab touch-none select-none overflow-hidden rounded-xl bg-muted active:cursor-grabbing"
          onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, pan }; }}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          <canvas ref={canvasRef} width={480} height={480} className="size-full" aria-label="Photo preview" />
          {/* face frame */}
          <div aria-hidden className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(15,23,42,0.45)] ring-2 ring-white/80" />
        </div>
        <label className="flex items-center gap-3 text-sm text-muted-foreground">
          Zoom
          <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1 accent-[var(--brand)]" />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(await renderPhoto(img, crop));
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save photo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
