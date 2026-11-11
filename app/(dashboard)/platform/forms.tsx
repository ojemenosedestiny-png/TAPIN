"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field as FormField, FormError, useActionFeedback } from "@/components/forms/field";
import { ConfirmDelete } from "@/components/forms/confirm-delete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSchool, createSchoolUser, deleteSchool, setDemoHandled, updateSchool, type FormState } from "./actions";

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

type SchoolRow = { id: string; name: string; timezone: string; resumption_time: string; absence_cutoff_time: string; closing_time: string; sms_sender_name: string | null; plan?: string | null };

/** Edit a school's name, hours, timezone or SMS sender name. */
export function EditSchoolDialog({ school }: { school: SchoolRow }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(updateSchool, {});
  useActionFeedback(state, () => setOpen(false));
  const e = state.errors ?? {};
  const id = (n: string) => `edit-${school.id}-${n}`;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Edit ${school.name}`}><Pencil className="size-4" aria-hidden /> Edit</Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>Edit {school.name}</DialogTitle>
            <DialogDescription>Changes apply straight away, including on the school&apos;s kiosks.</DialogDescription>
          </DialogHeader>
          <input type="hidden" name="id" value={school.id} />
          <FormError state={state} />
          <FormField id={id("name")} name="name" label="School name" defaultValue={school.name} error={e.name} required />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField id={id("res")} name="resumption_time" label="Resumption" type="time" defaultValue={school.resumption_time.slice(0, 5)} error={e.resumption_time} required />
            <FormField id={id("cut")} name="absence_cutoff_time" label="Absence cutoff" type="time" defaultValue={school.absence_cutoff_time.slice(0, 5)} error={e.absence_cutoff_time} required />
            <FormField id={id("close")} name="closing_time" label="Closing" type="time" defaultValue={school.closing_time.slice(0, 5)} error={e.closing_time} required />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField id={id("tz")} name="timezone" label="Timezone" defaultValue={school.timezone} error={e.timezone} required />
            <FormField id={id("sms")} name="sms_sender_name" label="SMS sender name (optional)" maxLength={11} defaultValue={school.sms_sender_name ?? ""} error={e.sms_sender_name} />
          </div>
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-ink">Plan</span>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Plan">
              {(["basic", "premium"] as const).map((p) => (
                <label key={p} className="cursor-pointer rounded-lg border border-border px-3 py-2.5 text-sm has-[:checked]:border-brand has-[:checked]:bg-accent">
                  <input type="radio" name="plan" value={p} defaultChecked={(school.plan ?? "basic") === p} className="sr-only" />
                  <span className="block font-medium text-ink">{p === "basic" ? "Basic" : "Premium"}</span>
                  <span className="block text-xs text-muted-foreground">{p === "basic" ? "Website: Starter" : "Website: Standard · adds Emergency roll call"}</span>
                </label>
              ))}
            </div>
            {e.plan && <p className="text-sm text-red-700">{e.plan}</p>}
          </div>
          <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save school"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteSchoolButton({ school }: { school: { id: string; name: string } }) {
  return (
    <ConfirmDelete action={deleteSchool} id={school.id} label="Delete" title={`Delete ${school.name}?`} confirmText={school.name}
      body={<>
        <p>This permanently deletes the school and <strong>everything in it</strong>: students, staff, attendance, cards, kiosks, photos and every login for this school. It can&apos;t be undone.</p>
        <p>Schools with invoices or payments on record can&apos;t be deleted.</p>
      </>} />
  );
}
