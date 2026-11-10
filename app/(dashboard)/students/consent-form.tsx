"use client";

import { useActionState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormError, withSuccessToast } from "@/components/forms/field";
import { recordConsent } from "./consent-actions";

export function ConsentForm({ studentId, today }: { studentId: string; today: string }) {
  // The form is replaced by the "Consent recorded" box on success, so toast straight from the action.
  const [state, action, pending] = useActionState(withSuccessToast(recordConsent), {});
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-3 rounded-xl bg-amber-50/60 p-4" noValidate>
      <p className="text-sm text-amber-950">No parental consent recorded yet. A photo can&apos;t be added until it is.</p>
      <input type="hidden" name="student_id" value={studentId} />
      <FormError state={state} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr]">
        <Field name="date" label="Form signed on" type="date" defaultValue={today} max={today} error={e.date} required />
        <Field name="note" label="How" placeholder="Signed form from mother" error={e.note} required />
      </div>
      <Button type="submit" size="sm" disabled={pending}><ShieldCheck className="size-4" /> {pending ? "Saving…" : "Record consent"}</Button>
    </form>
  );
}
