"use client";

import { useActionState, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormError, SelectField, useActionFeedback } from "@/components/forms/field";
import { cn } from "@/lib/utils";
import { addAssignment, addSubject, saveLessonSettings } from "./actions";

export type LessonSettingsValues = {
  enabled: boolean; min_minutes: number; max_minutes: number; autoclose_time: string;
  director_phone: string; director_alerts: "off" | "every" | "flagged" | "daily"; director_summary_time: string;
};

const MODES = [
  { v: "off", title: "Off", hint: "No messages" },
  { v: "flagged", title: "Flagged only", hint: "Too short, too long or not ended" },
  { v: "every", title: "Every lesson", hint: "One SMS as each lesson ends" },
  { v: "daily", title: "Daily summary", hint: "One SMS after school" },
] as const;

export function LessonSettingsForm({ values }: { values: LessonSettingsValues }) {
  const [state, action, pending] = useActionState(saveLessonSettings, {});
  useActionFeedback(state);
  const [on, setOn] = useState(values.enabled);
  const [mode, setMode] = useState(values.director_alerts);
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-6" noValidate>
      <FormError state={state} />
      <label className="flex cursor-pointer items-start gap-4 rounded-xl border border-border bg-background/60 p-4">
        <input type="checkbox" name="enabled" checked={on} onChange={(ev) => setOn(ev.target.checked)} role="switch" className="peer sr-only" />
        <span aria-hidden className={cn("relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50", on ? "bg-brand" : "bg-slate-300")}>
          <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform", on ? "translate-x-5.5" : "translate-x-0.5")} />
        </span>
        <span>
          <span className="block font-medium text-ink">Lesson check at the kiosk</span>
          <span className="mt-0.5 block text-sm text-muted-foreground">
            {on ? "On. After arriving, a teacher's tap offers Start lesson or Sign out; the next tap ends the lesson." : "Off. Teachers just sign in and out, as before."}
          </span>
        </span>
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field name="min_minutes" label="Too short under (min)" type="number" inputMode="numeric" min={1} defaultValue={values.min_minutes} error={e.min_minutes} />
        <Field name="max_minutes" label="Too long over (min)" type="number" inputMode="numeric" min={2} defaultValue={values.max_minutes} error={e.max_minutes} />
        <Field name="autoclose_time" label="Auto-close at" type="time" defaultValue={values.autoclose_time} error={e.autoclose_time}
          hint="Open lessons end and teachers are signed out" />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-ink">Director alerts</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {MODES.map((m) => (
            <label key={m.v} className={cn("cursor-pointer rounded-xl border px-4 py-3 transition-colors", mode === m.v ? "border-brand bg-accent" : "border-border hover:bg-muted/60")}>
              <input type="radio" name="director_alerts" value={m.v} checked={mode === m.v} onChange={() => setMode(m.v)} className="sr-only" />
              <span className="block text-sm font-medium text-ink">{m.title}</span>
              <span className="block text-xs text-muted-foreground">{m.hint}</span>
            </label>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field name="director_phone" label="Director's phone" type="tel" inputMode="tel" autoComplete="off" placeholder="0803 123 4567"
            defaultValue={values.director_phone} error={e.director_phone} hint="SMS, or WhatsApp once approved. Uses your SMS allowance." />
          <Field name="director_summary_time" label="Daily summary time" type="time" defaultValue={values.director_summary_time} error={e.director_summary_time}
            disabled={mode !== "daily"} />
        </div>
        {mode !== "daily" && <input type="hidden" name="director_summary_time" value={values.director_summary_time} />}
      </fieldset>

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">{pending ? "Saving…" : "Save lesson settings"}</Button>
    </form>
  );
}

export function AddSubjectForm() {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(addSubject, {});
  useActionFeedback(state, () => ref.current?.reset());
  return (
    <form ref={ref} action={action} className="flex flex-wrap items-start gap-2" noValidate>
      <Field name="name" id="subject-name" label="New subject" placeholder="e.g. Mathematics" error={state.errors?.name} className="min-w-0 flex-1 basis-56" />
      <Button type="submit" disabled={pending} className="mt-6"><Plus className="size-4" aria-hidden /> Add</Button>
      <div className="basis-full"><FormError state={state} /></div>
    </form>
  );
}

type Opt = { id: string; name: string };

export function AddAssignmentForm({ staff, classes, subjects }: { staff: Opt[]; classes: Opt[]; subjects: Opt[] }) {
  const [state, action, pending] = useActionState(addAssignment, {});
  useActionFeedback(state);
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormError state={state} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SelectField name="staff_id" id="as-staff" label="Teacher" defaultValue="" error={e.staff_id}>
          <option value="">Choose…</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </SelectField>
        <SelectField name="class_id" id="as-class" label="Class" defaultValue="" error={e.class_id}>
          <option value="">Choose…</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
        <SelectField name="subject_id" id="as-subject" label="Subject" defaultValue="" error={e.subject_id}>
          <option value="">Choose…</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </SelectField>
      </div>
      <Button type="submit" disabled={pending || !subjects.length} className="w-full sm:w-auto"><Plus className="size-4" aria-hidden /> Add to timetable</Button>
    </form>
  );
}
