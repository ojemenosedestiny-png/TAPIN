"use client";

import { useActionState, useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, useActionFeedback } from "@/components/forms/field";
import { changeStaffPin, setStaffPin } from "./actions";

/** Set or change a staff member's 4-digit kiosk PIN. The admin chooses it and tells the person privately. */
export function StaffPinDialog({ staffId, name, hasPin }: { staffId: string; name: string; hasPin: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(setStaffPin, {});
  useActionFeedback(state, () => setOpen(false));
  const e = state.errors ?? {};
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><KeyRound className="size-4" aria-hidden /> {hasPin ? "Change PIN" : "Set PIN"}</Button></DialogTrigger>
      <DialogContent>
        <form action={action} className="space-y-4" noValidate autoComplete="off">
          <DialogHeader>
            <DialogTitle>{hasPin ? "Change" : "Set"} {name}&apos;s PIN</DialogTitle>
            <DialogDescription>4 digits, typed on the kiosk after tapping their card. Nobody can see it afterwards, not even you.</DialogDescription>
          </DialogHeader>
          <input type="hidden" name="staff_id" value={staffId} />
          <FormError state={state} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field name="pin" id={`pin-${staffId}`} label="PIN" type="password" inputMode="numeric" maxLength={4} pattern="\d{4}" autoComplete="new-password" error={e.pin} required />
            <Field name="pin_again" id={`pin2-${staffId}`} label="PIN again" type="password" inputMode="numeric" maxLength={4} pattern="\d{4}" autoComplete="new-password" error={e.pin_again} required />
          </div>
          <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save PIN"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function StaffPinButton({ staffId, what, label }: { staffId: string; what: "remove" | "unlock"; label: string }) {
  const [state, action, pending] = useActionState(changeStaffPin, {});
  useActionFeedback(state);
  return (
    <form action={action} onSubmit={(ev) => { if (what === "remove" && !window.confirm("Remove this PIN? They will check in without one (marked “no PIN”).")) ev.preventDefault(); }}>
      <input type="hidden" name="staff_id" value={staffId} />
      <input type="hidden" name="what" value={what} />
      <Button type="submit" variant={what === "unlock" ? "outline" : "ghost"} disabled={pending}>{label}</Button>
    </form>
  );
}
