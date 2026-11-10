import { cn } from "@/lib/utils";

const SIZES = { sm: "size-9 text-xs", md: "size-12 text-sm", lg: "size-24 text-2xl", xl: "size-40 text-4xl" } as const;

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/** Round photo, or initials on mint when there is no photo yet. */
export function PersonAvatar({
  name,
  src,
  size = "sm",
  className,
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-light font-semibold text-brand-dark", SIZES[size], className)}>
      {src ? (
        // Signed, short-lived storage URLs: next/image would cache them past expiry.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <span aria-hidden>{initials(name)}</span>
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}
