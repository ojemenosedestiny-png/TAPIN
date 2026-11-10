import { brandIcon } from "@/lib/brand-icon";

const SIZES = { "192": 192, "512": 512, "maskable-512": 512 } as const;

export function generateStaticParams() {
  return Object.keys(SIZES).map((size) => ({ size }));
}

/** /pwa-icon/192, /pwa-icon/512, /pwa-icon/maskable-512 — home-screen icons for the kiosk app. */
export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const px = SIZES[size as keyof typeof SIZES];
  if (!px) return new Response("Not found", { status: 404 });
  return brandIcon(px, { maskable: size.startsWith("maskable") });
}
