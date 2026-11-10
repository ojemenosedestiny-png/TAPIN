"use client";

import { useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/** Side drawer opened by a URL param; closing navigates back to the list URL. */
export function DrawerShell({ closeHref, title, description, children }: { closeHref: string; title: string; description?: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <Sheet open onOpenChange={(o) => !o && router.push(closeHref, { scroll: false })}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="text-xl">{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div className="px-4 pb-10 sm:px-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
