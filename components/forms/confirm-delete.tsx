"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormError, useActionFeedback, withSuccessToast, type ActionState } from "@/components/forms/field";

/**
 * A delete button that asks first. For the most serious deletions, pass `confirmText`: the person must type it
 * (e.g. the school's name) before the button works. `afterHref` is where to go once it's deleted.
 */
export function ConfirmDelete({ action, id, label, title, body, confirmText, afterHref, size = "sm", variant = "outline" }: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  id: string;
  label: string;
  title: string;
  body: React.ReactNode;
  confirmText?: string;
  afterHref?: string;
  size?: "sm" | "default";
  variant?: "outline" | "ghost";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [state, formAction, pending] = useActionState(withSuccessToast(action), {});
  useActionFeedback(state, () => {
    setOpen(false);
    if (afterHref) router.push(afterHref, { scroll: false });
    router.refresh();
  });
  const ready = !confirmText || typed.trim().toLowerCase() === confirmText.trim().toLowerCase();

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setTyped(""); }}>
      <DialogTrigger asChild>
        <Button type="button" variant={variant} size={size} className="text-red-700 hover:text-red-800" aria-label={label}>
          <Trash2 className="size-4" aria-hidden /> {size === "sm" && variant === "ghost" ? null : label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={formAction} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription asChild><div className="space-y-2 text-sm text-muted-foreground">{body}</div></DialogDescription>
          </DialogHeader>
          <input type="hidden" name="id" value={id} />
          <FormError state={state} />
          {confirmText && (
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-ink">Type <strong>{confirmText}</strong> to confirm</span>
              <input name="confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off"
                className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Keep it</Button>
            <Button type="submit" disabled={pending || !ready} className="bg-red-600 text-white hover:bg-red-700">
              {pending ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
