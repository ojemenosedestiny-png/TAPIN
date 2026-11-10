"use client";

import { useActionState, useRef } from "react";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormError, useActionFeedback } from "@/components/forms/field";
import { addHolidays, saveSchoolDay } from "./school-actions";

type School = { resumption_time: string; absence_cutoff_time: string; closing_time: string; timezone: string; sms_sender_name: string | null };

export function SchoolDayForm({ school }: { school: School }) {
  const [state, action, pending] = useActionState(saveSchoolDay, {});
  useActionFeedback(state);
  const e = state.errors ?? {};
  const t = (v: string) => v.slice(0, 5);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError state={state} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field name="resumption_time" label="Resumption" type="time" defaultValue={t(school.resumption_time)} error={e.resumption_time} hint="Later than this is late" />
        <Field name="absence_cutoff_time" label="Absence cutoff" type="time" defaultValue={t(school.absence_cutoff_time)} error={e.absence_cutoff_time} hint="Absence SMS after this" />
        <Field name="closing_time" label="Closing" type="time" defaultValue={t(school.closing_time)} error={e.closing_time} hint="Taps after this sign out" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field name="timezone" label="Timezone" defaultValue={school.timezone} error={e.timezone} />
        <Field name="sms_sender_name" label="SMS sender ID (optional)" maxLength={11} defaultValue={school.sms_sender_name ?? ""} error={e.sms_sender_name}
          hint="Must be approved on Termii. Blank uses the platform sender." />
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save school day"}</Button>
    </form>
  );
}

export function HolidayForm() {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(addHolidays, {});
  useActionFeedback(state, () => ref.current?.reset());
  const e = state.errors ?? {};
  return (
    <form ref={ref} action={action} className="space-y-3" noValidate>
      <FormError state={state} />
      <div className="grid grid-cols-2 gap-3">
        <Field name="from" label="From" type="date" error={e.from} required />
        <Field name="to" label="To (optional)" type="date" error={e.to} />
      </div>
      <Field name="note" label="Note" placeholder="Mid-term break" error={e.note} />
      <Button type="submit" size="sm" disabled={pending}><CalendarPlus className="size-4" /> {pending ? "Adding…" : "Add holiday"}</Button>
    </form>
  );
}
