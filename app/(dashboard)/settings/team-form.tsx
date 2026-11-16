"use client";

import { useActionState, useRef } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormError, SelectField, useActionFeedback } from "@/components/forms/field";
import { createTeamLogin } from "./actions";

export function TeamForm({ org = false }: { org?: boolean }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(createTeamLogin, {});
  useActionFeedback(state, () => ref.current?.reset());
  const e = state.errors ?? {};
  return (
    <form ref={ref} action={action} className="space-y-4" noValidate>
      <FormError state={state} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field name="name" label="Full name" error={e.name} required />
        <Field name="email" label="Email" type="email" autoComplete="off" error={e.email} required />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field name="password" label="Temporary password" type="password" autoComplete="new-password" error={e.password}
          hint="10+ characters with upper and lower case and a number." required />
        {org ? (
          <div className="space-y-1.5">
            <input type="hidden" name="role" value="school_admin" />
            <p className="text-sm font-medium text-ink">Role</p>
            <p className="flex h-9 items-center text-sm text-muted-foreground">Admin: sees and manages everything</p>
          </div>
        ) : (
          <SelectField name="role" label="Role" defaultValue="teacher" error={e.role}>
            <option value="teacher">Teacher</option>
            <option value="school_admin">School admin</option>
          </SelectField>
        )}
      </div>
      <Button type="submit" disabled={pending}><UserPlus className="size-4" /> {pending ? "Creating…" : "Create login"}</Button>
    </form>
  );
}
