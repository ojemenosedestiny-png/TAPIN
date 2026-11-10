"use client";

import { useActionState, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, SelectField, useActionFeedback } from "@/components/forms/field";
import { saveClass } from "./actions";

type Teacher = { id: string; name: string };
type ClassRow = { id: string; name: string; class_teacher_id: string | null };

export function ClassDialog({ teachers, existing }: { teachers: Teacher[]; existing?: ClassRow }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(saveClass, {});
  useActionFeedback(state, () => setOpen(false));
  const e = state.errors ?? {};

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {existing ? (
          <Button variant="ghost" size="sm" aria-label={`Edit ${existing.name}`}><Pencil className="size-4" /> Edit</Button>
        ) : (
          <Button><Plus className="size-4" /> New class</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <form action={action} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{existing ? `Edit ${existing.name}` : "New class"}</DialogTitle>
            <DialogDescription>Classes group students for attendance and enrollment.</DialogDescription>
          </DialogHeader>
          {existing && <input type="hidden" name="id" value={existing.id} />}
          <FormError state={state} />
          <Field name="name" label="Class name" placeholder="JSS2A" defaultValue={existing?.name} error={e.name} required autoFocus />
          <SelectField name="class_teacher_id" label="Class teacher" defaultValue={existing?.class_teacher_id ?? ""} error={e.class_teacher_id}>
            <option value="">No class teacher yet</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </SelectField>
          {teachers.length === 0 && (
            <p className="text-xs text-muted-foreground">No teacher logins yet. Add them under Settings → Team.</p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save class"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
