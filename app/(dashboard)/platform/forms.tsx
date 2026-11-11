"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSchool, createSchoolUser, setDemoHandled, type FormState } from "./actions";

function Field({ name, label, error, ...props }: { name: string; label: string; error?: string } & React.ComponentProps<"input">) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} aria-invalid={!!error} aria-describedby={error ? `${name}-error` : undefined} {...props} />
      {error && <p id={`${name}-error`} className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

function Status({ state }: { state: FormState }) {
  if (state.errors?._form) return <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{state.errors._form}</p>;
  if (state.ok) return <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{state.ok}</p>;
  return null;
}

function useResetOnSuccess(state: FormState) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return ref;
}

export function CreateSchoolForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createSchool, {});
  const ref = useResetOnSuccess(state);
  const e = state.errors ?? {};
  return (
    <form ref={ref} action={action} className="space-y-4" noValidate>
      <Status state={state} />
      <Field name="name" label="School name" error={e.name} required />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field name="resumption_time" label="Resumption" type="time" defaultValue="07:45" error={e.resumption_time} required />
        <Field name="absence_cutoff_time" label="Absence cutoff" type="time" defaultValue="09:00" error={e.absence_cutoff_time} required />
        <Field name="closing_time" label="Closing" type="time" defaultValue="14:00" error={e.closing_time} required />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field name="timezone" label="Timezone" defaultValue="Africa/Lagos" error={e.timezone} required />
        <Field name="sms_sender_name" label="SMS sender name (optional)" maxLength={11} error={e.sms_sender_name} />
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create school"}</Button>
    </form>
  );
}

export function CreateUserForm({ schools }: { schools: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createSchoolUser, {});
  const ref = useResetOnSuccess(state);
  const e = state.errors ?? {};
  const selectClass =
    "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none";
  return (
    <form ref={ref} action={action} className="space-y-4" noValidate>
      <Status state={state} />
      <div className="space-y-1.5">
        <Label htmlFor="school_id">School</Label>
        <select id="school_id" name="school_id" className={selectClass} required defaultValue="">
          <option value="" disabled>Choose a school</option>
          {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {e.school_id && <p className="text-sm text-red-700">{e.school_id}</p>}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field name="name" label="Full name" error={e.name} required />
        <Field name="email" label="Email" type="email" autoComplete="off" error={e.email} required />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field name="password" label="Temporary password" type="password" autoComplete="new-password" error={e.password} required />
        <div className="space-y-1.5">
          <Label htmlFor="role">Role</Label>
          <select id="role" name="role" className={selectClass} defaultValue="school_admin">
            <option value="school_admin">School admin</option>
            <option value="teacher">Teacher</option>
          </select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">At least 10 characters with upper and lower case letters and a number.</p>
      <Button type="submit" disabled={pending || schools.length === 0}>{pending ? "Creating…" : "Create account"}</Button>
    </form>
  );
}

export function DemoHandledButton({ id, handled }: { id: string; handled: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setDemoHandled, {});
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="handled" value={handled ? "0" : "1"} />
      <Button type="submit" size="sm" variant={handled ? "ghost" : "outline"} disabled={pending}>
        {handled ? "Undo" : "Mark as called"}
      </Button>
      {state.errors?._form && <span className="ml-2 text-xs text-red-700">{state.errors._form}</span>}
    </form>
  );
}
