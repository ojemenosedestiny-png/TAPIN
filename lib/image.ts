/**
 * Photo crop + compression (build plan §10 "Photo capture").
 * Square face frame, JPEG, under 200 KB. Pure math is exported for tests; canvas work runs in the browser.
 */

export const PHOTO_SIZE = 480; // px, square
export const PHOTO_MAX_BYTES = 200 * 1024;

export type Crop = { x: number; y: number; size: number }; // in source-image pixels

/** Largest centred square. */
export function centerSquare(width: number, height: number): Crop {
  const size = Math.min(width, height);
  return { x: Math.round((width - size) / 2), y: Math.round((height - size) / 2), size };
}

/**
 * Crop for a given zoom (1 = largest square) and pan offset (-1…1 on each axis, 0 = centred).
 * Always stays inside the image.
 */
export function cropFor(width: number, height: number, zoom: number, panX: number, panY: number): Crop {
  const base = Math.min(width, height);
  const size = Math.max(1, Math.round(base / Math.max(1, zoom)));
  const maxX = width - size;
  const maxY = height - size;
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const x = Math.round(maxX / 2 + (clamp(panX) * maxX) / 2);
  const y = Math.round(maxY / 2 + (clamp(panY) * maxY) / 2);
  return { x, y, size };
}

/** "STU0012.jpg" → "STU0012" (for bulk upload matching). */
export function admissionFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").trim().toUpperCase();
}

export async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // decode() has finished; the element keeps its pixels.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Draws the crop into a square canvas and compresses to JPEG under PHOTO_MAX_BYTES. */
export async function renderPhoto(img: HTMLImageElement, crop: Crop): Promise<Blob> {
  let size = PHOTO_SIZE;
  for (let attempt = 0; attempt < 3; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available in this browser.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, crop.x, crop.y, crop.size, crop.size, 0, 0, size, size);
    for (const quality of [0.86, 0.78, 0.7, 0.6, 0.5]) {
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
      if (blob && blob.size <= PHOTO_MAX_BYTES) return blob;
    }
    size = Math.round(size * 0.75);
  }
  throw new Error("Couldn't make this photo small enough. Try a different photo.");
}
