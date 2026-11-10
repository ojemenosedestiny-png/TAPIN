"use client";

import { useActionState, useRef } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormError, useActionFeedback } from "@/components/forms/field";
import { addGuardian } from "./actions";

export function GuardianForm({ studentId }: { studentId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(addGuardian, {});
  useActionFeedback(state, () => ref.current?.reset());
  const e = state.errors ?? {};
  return (
    <form ref={ref} action={action} className="space-y-3 rounded-xl bg-muted/40 p-4" noValidate>
      <p className="text-sm font-medium text-ink">Add guardian</p>
      <input type="hidden" name="student_id" value={studentId} />
      <FormError state={state} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field name="name" label="Name" error={e.name} required />
        <Field name="phone" label="Mobile number" type="tel" inputMode="tel" placeholder="0803 123 4567" error={e.phone} required />
      </div>
      <Field name="relationship" label="Relationship (optional)" placeholder="Mother" error={e.relationship} />
      <Button type="submit" size="sm" disabled={pending}><UserPlus className="size-4" /> {pending ? "Adding…" : "Add guardian"}</Button>
    </form>
  );
}
