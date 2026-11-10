"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, SelectField, useActionFeedback } from "@/components/forms/field";
import { saveStudent } from "./actions";

type Student = { id: string; admission_no: string; first_name: string; last_name: string; class_id: string | null; status: string };

export function StudentDialog({ classes, existing }: { classes: { id: string; name: string }[]; existing?: Student }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(saveStudent, {});
  useActionFeedback(state, () => {
    setOpen(false);
    // Open the new student's profile so the admin can add a photo, guardians and a card.
    const id = (state.data as { id?: string } | undefined)?.id;
    if (!existing && id) router.push(`/students?student=${id}`, { scroll: false });
  });
  const e = state.errors ?? {};

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {existing ? <Button variant="outline" size="sm"><Pencil className="size-4" /> Edit details</Button> : <Button><Plus className="size-4" /> Add student</Button>}
      </DialogTrigger>
      <DialogContent>
        <form action={action} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{existing ? "Edit student" : "Add student"}</DialogTitle>
            <DialogDescription>Only the details needed for attendance are collected.</DialogDescription>
          </DialogHeader>
          {existing && <input type="hidden" name="id" value={existing.id} />}
          <FormError state={state} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field name="first_name" label="First name" defaultValue={existing?.first_name} error={e.first_name} required autoFocus />
            <Field name="last_name" label="Last name" defaultValue={existing?.last_name} error={e.last_name} required />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field name="admission_no" label="Admission no." defaultValue={existing?.admission_no} error={e.admission_no} required className="[&_input]:uppercase" />
            <SelectField name="class_id" label="Class" defaultValue={existing?.class_id ?? ""} error={e.class_id}>
              <option value="">No class</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </SelectField>
          </div>
          {existing && (
            <SelectField name="status" label="Status" defaultValue={existing.status} error={e.status}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="graduated">Graduated</option>
              <option value="withdrawn">Withdrawn</option>
            </SelectField>
          )}
          {existing && <p className="text-xs text-muted-foreground">Setting a student to anything other than Active blocks their card.</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : existing ? "Save changes" : "Add student"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
