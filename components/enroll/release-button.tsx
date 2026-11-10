"use client";

import { useActionState, useState } from "react";
import { DoorOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, withSuccessToast, type ActionState } from "@/components/forms/field";
import { releaseEarly } from "@/app/(dashboard)/_actions/release";
import { cn } from "@/lib/utils";

const REASONS = ["Sick", "Medical appointment", "Collected by parent", "Family emergency", "Approved leave"];

/** Early release: allow the next gate tap to sign out before closing, or sign out now. */
export function ReleaseButton({ holderType, holderId, name, size = "sm" }: { holderType: "student" | "staff"; holderId: string; name: string; size?: "sm" | "default" }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, action, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await withSuccessToast(releaseEarly)(prev, fd);
    if (r.ok) setOpen(false);
    return r;
  }, {});
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size={size} className="motion-press"><DoorOpen className="size-3.5" /> Release early</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={action} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Release {name} early</DialogTitle>
            <DialogDescription>
              {holderType === "student" ? "Parents get a text saying when and why." : "Recorded in today's attendance."} Before closing time, a tap only signs out after a release.
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="holder_type" value={holderType} />
          <input type="hidden" name="holder_id" value={holderId} />
          <FormError state={state} />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Common reasons">
            {REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)}
                className={cn("motion-press rounded-full px-3 py-1.5 text-sm ring-1 ring-inset",
                  reason === r ? "bg-brand-light text-brand-dark ring-brand/30" : "bg-card text-muted-foreground ring-border hover:text-ink")}>
                {r}
              </button>
            ))}
          </div>
          <Field name="reason" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} error={state.errors?.reason} required />
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="submit" name="mode" value="now" variant="outline" disabled={pending || reason.trim().length < 2}>Sign out now</Button>
            <Button type="submit" name="mode" value="gate" disabled={pending || reason.trim().length < 2}>{pending ? "Saving…" : "Allow at the gate"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
