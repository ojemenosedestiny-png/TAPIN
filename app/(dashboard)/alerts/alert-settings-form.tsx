"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Field, FormError, useActionFeedback } from "@/components/forms/field";
import { renderTemplate, smsPages, unknownFields, TEMPLATE_FIELDS, type AlertSettings } from "@/lib/alert-rules";
import { cn } from "@/lib/utils";
import { saveAlertSettings } from "./actions";

const TYPES = [
  { key: "arrival", title: "Arrival", when: "First valid tap of the day", to: "All linked guardians" },
  { key: "late", title: "Late arrival", when: "Sign-in after resumption time (replaces the arrival SMS)", to: "Guardians + class teacher dashboard" },
  { key: "departure", title: "Departure", when: "Sign-out tap after closing time", to: "All linked guardians" },
  { key: "absence", title: "Absence", when: "No sign-in by the absence cutoff time", to: "All linked guardians" },
  { key: "early", title: "Early release", when: "Signed out before closing, released by the school", to: "All linked guardians · always sent" },
] as const;

const SAMPLE = { greeting: "Good morning", full_name: "Chioma Okafor", first_name: "Chioma", time: "7:42 AM", date: "Tuesday 10 November", reason: "Sick, collected by mother" };

function Switch({ name, defaultChecked, label, onChange }: { name: string; defaultChecked: boolean; label: string; onChange?: (v: boolean) => void }) {
  const [on, setOn] = useState(defaultChecked);
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <input type="checkbox" name={name} checked={on} onChange={(e) => { setOn(e.target.checked); onChange?.(e.target.checked); }} className="peer sr-only" role="switch" aria-label={label} />
      <span aria-hidden className={cn("relative h-6 w-11 rounded-full transition-colors peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50", on ? "bg-brand" : "bg-slate-300")}>
        <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform", on ? "translate-x-5.5" : "translate-x-0.5")} />
      </span>
      <span className="text-sm text-muted-foreground">{on ? "On" : "Off"}</span>
    </label>
  );
}

export function AlertSettingsForm({ settings, schoolName }: { settings: AlertSettings; schoolName: string }) {
  const [state, action, pending] = useActionState(saveAlertSettings, {});
  useActionFeedback(state);
  const e = state.errors ?? {};
  const [templates, setTemplates] = useState({
    arrival: settings.arrival_template, late: settings.late_template, departure: settings.departure_template, absence: settings.absence_template,
    early: settings.early_template,
  });
  const [enabled, setEnabled] = useState({
    arrival: settings.arrival_enabled, late: settings.late_enabled, departure: settings.departure_enabled, absence: settings.absence_enabled,
    early: true,
  });
  const [summary, setSummary] = useState(settings.summary_mode);

  return (
    <form action={action} className="space-y-6" noValidate>
      <FormError state={state} />

      <div className="space-y-4">
        {TYPES.map((t) => {
          const preview = renderTemplate(templates[t.key], { ...SAMPLE, school: schoolName });
          const unknown = unknownFields(templates[t.key]);
          const pages = smsPages(preview);
          const heldBySummary = summary && (t.key === "arrival" || t.key === "departure");
          return (
            <fieldset key={t.key} className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <legend className="font-semibold text-ink">{t.title}</legend>
                  <p className="text-sm text-muted-foreground">{t.when} · {t.to}</p>
                </div>
                {t.key === "early" ? (
                  <span className="text-sm text-muted-foreground">Always on</span>
                ) : (
                  <Switch name={`${t.key}_enabled`} defaultChecked={enabled[t.key]} label={`${t.title} SMS`} onChange={(v) => setEnabled((s) => ({ ...s, [t.key]: v }))} />
                )}
              </div>
              {heldBySummary && enabled[t.key] && (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">Daily summary is on, so this is included in the evening summary instead of sent straight away.</p>
              )}
              <div className={cn("mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2", !enabled[t.key] && "opacity-60")}>
                <div className="space-y-1.5">
                  <Label htmlFor={`${t.key}_template`}>Message</Label>
                  <textarea
                    id={`${t.key}_template`} name={`${t.key}_template`} rows={3} value={templates[t.key]} maxLength={480}
                    onChange={(ev) => setTemplates((s) => ({ ...s, [t.key]: ev.target.value }))}
                    aria-invalid={!!e[`${t.key}_template`]}
                    className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                  {e[`${t.key}_template`] && <p className="text-sm text-red-700">{e[`${t.key}_template`]}</p>}
                  {unknown.length > 0 && <p className="text-xs text-amber-800">Unknown field{unknown.length > 1 ? "s" : ""}: {unknown.map((u) => `{${u}}`).join(", ")} — sent as typed.</p>}
                </div>
                <div>
                  <p className="mb-1.5 text-sm font-medium text-ink">Preview</p>
                  <div className="rounded-2xl rounded-tl-sm bg-muted px-4 py-3 text-sm text-ink">{preview}</div>
                  <p className={cn("mt-1.5 text-xs tabular-nums", pages > 1 ? "text-amber-800" : "text-muted-foreground")}>
                    {preview.length} characters · {pages} SMS page{pages > 1 ? "s" : ""} per guardian{pages > 1 ? " (costs more)" : ""}
                  </p>
                </div>
              </div>
            </fieldset>
          );
        })}
        <p className="text-xs text-muted-foreground">Fields you can use: {TEMPLATE_FIELDS.map((f) => `{${f}}`).join(" ")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <fieldset className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <legend className="font-semibold text-ink">Daily summary</legend>
          <p className="mb-3 text-sm text-muted-foreground">Save cost: one evening SMS with arrival and departure times instead of two.</p>
          <Switch name="summary_mode" defaultChecked={settings.summary_mode} label="Daily summary" onChange={setSummary} />
          <Field name="summary_time" label="Send at" type="time" defaultValue={settings.summary_time.slice(0, 5)} error={e.summary_time} className="mt-3" />
        </fieldset>
        <fieldset className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <legend className="font-semibold text-ink">Quiet hours</legend>
          <p className="mb-3 text-sm text-muted-foreground">Messages created during quiet hours wait until they end.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field name="quiet_start" label="From" type="time" defaultValue={settings.quiet_start.slice(0, 5)} error={e.quiet_start} />
            <Field name="quiet_end" label="Until" type="time" defaultValue={settings.quiet_end.slice(0, 5)} error={e.quiet_end} />
          </div>
        </fieldset>
        <fieldset className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <legend className="font-semibold text-ink">Monthly allowance</legend>
          <p className="mb-3 text-sm text-muted-foreground">Sending stops when this many SMS have gone out this month.</p>
          <Field name="monthly_allowance" label="SMS per month" type="number" min={0} inputMode="numeric" defaultValue={settings.monthly_allowance} error={e.monthly_allowance} />
        </fieldset>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending} className="h-11 px-6">{pending ? "Saving…" : "Save alert settings"}</Button>
      </div>
    </form>
  );
}
