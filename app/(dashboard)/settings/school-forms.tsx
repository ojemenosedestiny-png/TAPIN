"use client";

import { useActionState, useRef } from "react";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormError, useActionFeedback } from "@/components/forms/field";
import { addHolidays, saveHandover, saveRetention, saveSchoolDay, saveStaffSecurity } from "./school-actions";

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

export function RetentionForm({ months }: { months: number }) {
  const [state, action, pending] = useActionState(saveRetention, {});
  useActionFeedback(state);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3" noValidate>
      <FormError state={state} />
      <Field name="retention_months" label="Keep leavers' records for (months)" type="number" min={1} max={84} inputMode="numeric"
        defaultValue={months} error={state.errors?.retention_months} className="w-64" />
      <Button type="submit" variant="outline" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
    </form>
  );
}

export function HandoverForm({ enabled, minutes }: { enabled: boolean; minutes: number }) {
  const [state, action, pending] = useActionState(saveHandover, {});
  useActionFeedback(state);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError state={state} />
      <label className="flex items-start gap-3 rounded-lg bg-muted/60 p-4 text-sm">
        <input type="checkbox" name="handover_enabled" defaultChecked={enabled} className="mt-0.5 size-4 accent-[var(--brand)]" />
        <span>
          <span className="block font-medium text-ink">Parents tap their card at the gate</span>
          <span className="text-muted-foreground">
            Drop-off: the child taps, then the parent within 2 minutes. Pickup: the parent taps first, then the child, and staff confirm.
            Bus children always tap on their own. Give parents a card in Safe pickup → Add a parent.
          </span>
        </span>
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <Field name="late_pickup_minutes" label="Late pickup alert (minutes after closing)" type="number" min={0} max={240} inputMode="numeric"
          defaultValue={minutes} error={state.errors?.late_pickup_minutes} className="w-72" />
        <Button type="submit" variant="outline" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
      </div>
    </form>
  );
}

type StaffSecurityValues = { staff_pin_required: boolean; staff_photo: boolean; staff_alerts: boolean; staff_from: string | null; staff_until: string | null };

/** Staff check-in security. Each switch works on its own. */
export function StaffSecurityForm({ values, staffWithoutPin }: { values: StaffSecurityValues; staffWithoutPin: number }) {
  const [state, action, pending] = useActionState(saveStaffSecurity, {});
  useActionFeedback(state);
  const e = state.errors ?? {};
  const box = (name: keyof StaffSecurityValues, title: string, body: React.ReactNode) => (
    <label className="flex items-start gap-3 rounded-lg bg-muted/60 p-4 text-sm">
      <input type="checkbox" name={name} defaultChecked={!!values[name]} className="mt-0.5 size-4 accent-[var(--brand)]" />
      <span><span className="block font-medium text-ink">{title}</span><span className="text-muted-foreground">{body}</span></span>
    </label>
  );
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormError state={state} />
      {box("staff_pin_required", "Card + 4-digit PIN", <>After tapping, staff type their own PIN on the kiosk, so nobody can check in with someone else&apos;s card. 5 wrong tries lock that person for 15 minutes. Set each person&apos;s PIN on the Staff page.{staffWithoutPin > 0 && <strong className="mt-1 block font-medium text-amber-800">{staffWithoutPin} staff {staffWithoutPin === 1 ? "has" : "have"} no PIN yet: they can still check in, marked &ldquo;no PIN&rdquo;.</strong>}</>)}
      {box("staff_photo", "Photo at every check-in and check-out", "The kiosk's front camera takes a small photo, so you can see who really tapped. Photos are private to your school and deleted after 30 days.")}
      {box("staff_alerts", "Alerts", "A notice when staff check in late, leave before closing, get locked out by wrong PINs, or forget to check out.")}
      <div className="flex flex-wrap items-end gap-3">
        <Field name="staff_from" label="Staff may check in from" type="time" defaultValue={values.staff_from?.slice(0, 5) ?? ""} error={e.staff_from} className="w-48" />
        <Field name="staff_until" label="until" type="time" defaultValue={values.staff_until?.slice(0, 5) ?? ""} error={e.staff_until} className="w-48" />
        <Button type="submit" variant="outline" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
      </div>
      <p className="text-xs text-muted-foreground">Leave the times empty for no limit. Staff can only ever check in on your school&apos;s registered kiosks.</p>
    </form>
  );
}
