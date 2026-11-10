"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, SelectField, useActionFeedback } from "@/components/forms/field";
import { saveStaff } from "./actions";

type Staff = { id: string; name: string; phone: string | null; status: string };

export function StaffDialog({ existing }: { existing?: Staff }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(saveStaff, {});
  useActionFeedback(state, () => {
    setOpen(false);
    const id = (state.data as { id?: string } | undefined)?.id;
    if (!existing && id) router.push(`/staff?person=${id}`, { scroll: false });
  });
  const e = state.errors ?? {};
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {existing ? <Button variant="outline" size="sm"><Pencil className="size-4" /> Edit details</Button> : <Button><Plus className="size-4" /> Add staff</Button>}
      </DialogTrigger>
      <DialogContent>
        <form action={action} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{existing ? "Edit staff member" : "Add staff member"}</DialogTitle>
            <DialogDescription>Staff who tap in at the gate. Dashboard logins are managed under Settings → Team.</DialogDescription>
          </DialogHeader>
          {existing && <input type="hidden" name="id" value={existing.id} />}
          <FormError state={state} />
          <Field name="name" label="Full name" defaultValue={existing?.name} error={e.name} required autoFocus />
          <Field name="phone" label="Mobile number (optional)" type="tel" inputMode="tel" defaultValue={existing?.phone ?? ""} error={e.phone} />
          {existing && (
            <SelectField name="status" label="Status" defaultValue={existing.status}>
              <option value="active">Active</option>
              <option value="inactive">Inactive (blocks card)</option>
            </SelectField>
          )}
          <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
