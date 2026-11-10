"use client";

import { useActionState, useRef } from "react";
import { CalendarCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormError, useActionFeedback } from "@/components/forms/field";
import { addExcusal } from "./excusal-actions";

export function ExcusalForm({ studentId, today }: { studentId: string; today: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(addExcusal, {});
  useActionFeedback(state, () => ref.current?.reset());
  const e = state.errors ?? {};
  return (
    <form ref={ref} action={action} className="space-y-3 rounded-xl bg-muted/40 p-4" noValidate>
      <input type="hidden" name="student_id" value={studentId} />
      <FormError state={state} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr]">
        <Field name="date" label="Date" type="date" defaultValue={today} error={e.date} required />
        <Field name="reason" label="Reason" placeholder="Sick note" error={e.reason} required />
      </div>
      <Button type="submit" size="sm" disabled={pending}><CalendarCheck2 className="size-4" /> {pending ? "Saving…" : "Mark excused"}</Button>
    </form>
  );
}
