"use client";

import { useActionState, useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, SelectField, useActionFeedback } from "@/components/forms/field";
import { ConfirmDelete } from "@/components/forms/confirm-delete";
import { removeTeamMember, updateTeamMember } from "./actions";

type Member = { id: string; name: string; email: string; role: "school_admin" | "teacher"; staff_id: string | null };

/** Edit name/role and remove a dashboard login. You can edit your own name but not remove yourself. */
export function TeamMemberActions({ member, isSelf, staff }: { member: Member; isSelf: boolean; staff: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updateTeamMember, {});
  useActionFeedback(state, () => setOpen(false));
  const e = state.errors ?? {};
  return (
    <div className="flex items-center gap-1">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={`Edit ${member.name}`}><Pencil className="size-4" aria-hidden /></Button>
        </DialogTrigger>
        <DialogContent>
          <form action={action} className="space-y-4" noValidate>
            <DialogHeader>
              <DialogTitle>Edit {member.name}</DialogTitle>
              <DialogDescription>{member.email} · the email can&apos;t be changed here.</DialogDescription>
            </DialogHeader>
            <input type="hidden" name="id" value={member.id} />
            <FormError state={state} />
            <Field name="name" label="Full name" defaultValue={member.name} error={e.name} required />
            <SelectField name="role" label="Role" defaultValue={member.role} error={e.role} disabled={isSelf}>
              <option value="school_admin">School admin</option>
              <option value="teacher">Teacher</option>
            </SelectField>
            {isSelf && <input type="hidden" name="role" value={member.role} />}
            <SelectField name="staff_id" id={`staff-${member.id}`} label="Staff profile" defaultValue={member.staff_id ?? ""} error={e.staff_id}>
              <option value="">Not linked</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </SelectField>
            <p className="-mt-2 text-xs text-muted-foreground">Linked teachers see their own monthly report under My report.</p>
            <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {!isSelf && (
        <ConfirmDelete action={removeTeamMember} id={member.id} label={`Remove ${member.name}`} variant="ghost" title={`Remove ${member.name}'s login?`}
          body={<p>{member.name} won&apos;t be able to sign in any more. Attendance records aren&apos;t affected. You can add them again later.</p>} />
      )}
    </div>
  );
}
