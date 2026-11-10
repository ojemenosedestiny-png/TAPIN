"use client";

import { useActionState, useState } from "react";
import { CalendarCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, useActionFeedback } from "@/components/forms/field";
import { addExcusal } from "@/app/(dashboard)/students/excusal-actions";

const REASONS = ["Sick", "Medical appointment", "Family emergency", "Approved leave"];

/** Mark a student's absence as excused in two taps (the teacher's most common job on this screen). */
export function ExcuseButton({ studentId, name, date }: { studentId: string; name: string; date: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, action, pending] = useActionState(addExcusal, {});
  useActionFeedback(state, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="motion-press"><CalendarCheck2 className="size-3.5" /> Excuse</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form action={action} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Excuse {name}</DialogTitle>
            <DialogDescription>No absence SMS is sent for an excused day.</DialogDescription>
          </DialogHeader>
          <input type="hidden" name="student_id" value={studentId} />
          <input type="hidden" name="date" value={date} />
          <FormError state={state} />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Common reasons">
            {REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)}
                className={`motion-press rounded-full px-3 py-1.5 text-sm ring-1 ring-inset ${reason === r ? "bg-brand-light text-brand-dark ring-brand/30" : "bg-card text-muted-foreground ring-border hover:text-ink"}`}>
                {r}
              </button>
            ))}
          </div>
          <Field name="reason" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} error={state.errors?.reason} required />
          <DialogFooter>
            <Button type="submit" disabled={pending || reason.trim().length < 2}>{pending ? "Saving…" : "Mark excused"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
