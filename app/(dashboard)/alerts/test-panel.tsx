"use client";

import { useActionState, useState } from "react";
import { BellRing, CheckCheck, LogIn, LogOut, Play, Send, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormError, selectClass, useActionFeedback } from "@/components/forms/field";
import { Label } from "@/components/ui/label";
import { greetingForHour, warmUpVoices } from "@/lib/greeting";
import { phraseForTap, phraseText, type Phrase } from "@/lib/voice-phrases";
import { sayPhrase } from "@/lib/voice-client";
import { play, soundLengthMs, unlockAudio, type SoundName } from "@/lib/sound";
import { testAlertMessage, type AlertType } from "@/lib/alert-rules";
import { cn } from "@/lib/utils";
import { sendTestAlert, type TestAlertState } from "./actions";

const SOUNDS: { name: SoundName; label: string; hint: string; Icon: typeof LogIn; phrase: () => Phrase }[] = [
  { name: "signIn", label: "Sign in", hint: "Rising chime and greeting", Icon: LogIn, phrase: () => phraseForTap("signed_in", "Chioma", new Date().getHours()) },
  { name: "signOut", label: "Sign out", hint: "Falling chime and goodbye", Icon: LogOut, phrase: () => phraseForTap("signed_out", "Chioma", 15) },
  { name: "duplicate", label: "Already tapped", hint: "One soft note", Icon: CheckCheck, phrase: () => ({ kind: "already_in" }) },
  { name: "error", label: "Not recognised", hint: "Low, gentle warning", Icon: ShieldAlert, phrase: () => ({ kind: "unknown" }) },
];

const LABEL: Record<AlertType, string> = { arrival: "Arrival", late: "Late arrival", departure: "Departure", absence: "Absence", early: "Early release" };

export type Channels = { sms: boolean; whatsapp: boolean; waTemplates: Record<AlertType, boolean> };

export function TestPanel({ templates, schoolName, channels }: { templates: Record<AlertType, string>; schoolName: string; channels: Channels }) {
  const [via, setVia] = useState<"sms" | "whatsapp">(channels.sms || !channels.whatsapp ? "sms" : "whatsapp");
  const [playing, setPlaying] = useState<SoundName | null>(null);
  const [type, setType] = useState<AlertType>("arrival");
  const [state, action, pending] = useActionState<TestAlertState, FormData>(sendTestAlert, {});
  useActionFeedback(state);
  const preview = state.data?.message ?? testAlertMessage(templates[type], schoolName);

  const trySound = (s: (typeof SOUNDS)[number]) => {
    unlockAudio();
    warmUpVoices();
    setPlaying(s.name);
    play(s.name);
    const p = s.phrase();
    // The first play of a phrase is made by ElevenLabs (a second or two); after that it is instant.
    void sayPhrase(p, phraseText(p), { delayMs: soundLengthMs(s.name), waitMs: 6000 });
    setTimeout(() => setPlaying((p) => (p === s.name ? null : p)), 2600);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Gate sounds */}
      <div className="surface rounded-2xl p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-light text-brand"><BellRing className="size-5" aria-hidden /></span>
          <div>
            <h3 className="font-semibold text-ink">Gate sounds</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">Hear exactly what plays at the kiosk. Turn your volume up.</p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {SOUNDS.map((s) => (
            <button key={s.name} type="button" onClick={() => trySound(s)} aria-label={`Play ${s.label}`}
              className={cn("motion-press group flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3 text-left transition-colors hover:border-brand/40 hover:bg-accent",
                playing === s.name && "border-brand/50 bg-accent")}>
              <span className={cn("relative flex size-9 shrink-0 items-center justify-center rounded-full",
                s.name === "error" ? "bg-red-50 text-red-700" : "bg-brand-light text-brand")}>
                {playing === s.name ? <span className="motion-live relative size-2.5 rounded-full bg-current" aria-hidden /> : <s.Icon className="size-4" aria-hidden />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{s.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{s.hint}</span>
              </span>
              <Play className="ml-auto size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </button>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Spoken in your school voice (ElevenLabs). The first play of each phrase takes a second; after that it is instant. If the voice service is unreachable, the device voice says the same words.
          It greets with {greetingForHour(new Date().getHours()).toLowerCase()} now.
        </p>
      </div>

      {/* Test alert */}
      <form action={action} className="surface rounded-2xl p-5 sm:p-6" noValidate>
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-light text-brand"><Send className="size-5" aria-hidden /></span>
          <div>
            <h3 className="font-semibold text-ink">Send a test alert</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">Your real wording with a sample child, marked TEST. It does not count toward your allowance.</p>
          </div>
        </div>
        <FormError state={state} />
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {channels.whatsapp && (
            <div className="space-y-1.5 sm:col-span-2">
              <span className="text-sm font-medium text-ink">Send by</span>
              <div role="radiogroup" aria-label="Send by" className="flex gap-2">
                {(["whatsapp", "sms"] as const).map((v) => (
                  <label key={v} className={cn("flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
                    via === v ? "border-brand bg-accent text-ink" : "border-border text-muted-foreground hover:text-ink")}>
                    <input type="radio" name="via" value={v} checked={via === v} onChange={() => setVia(v)} className="sr-only" />
                    {v === "whatsapp" ? "WhatsApp" : "SMS"}
                    {v === "sms" && !channels.sms && <span className="text-xs font-normal text-muted-foreground">(preview only)</span>}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="test-type">Alert type</Label>
            <select id="test-type" name="type" value={type} onChange={(e) => setType(e.target.value as AlertType)} className={cn(selectClass, "w-full")}>
              {(Object.keys(LABEL) as AlertType[]).map((k) => <option key={k} value={k}>{LABEL[k]}</option>)}
            </select>
          </div>
          <Field name="phone" id="test-phone" label="Send to" type="tel" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" error={state.errors?.phone} />
        </div>

        {/* Phone preview */}
        <div className="mt-5 rounded-2xl bg-muted/70 p-4 ring-1 ring-inset ring-border">
          <p className="text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{schoolName} · {via === "whatsapp" ? "WhatsApp" : "SMS"}</p>
          <p key={preview} className="motion-rise mt-3 max-w-[90%] rounded-2xl rounded-bl-md bg-card px-4 py-3 text-sm leading-6 text-ink shadow-sm ring-1 ring-border" aria-live="polite">
            {preview}
          </p>
          {state.data && (
            <p className={cn("mt-2 text-xs", state.data.sent ? "text-green-800" : "text-muted-foreground")}>
              {state.data.sent
                ? state.data.via === "whatsapp" ? "Sent by WhatsApp, using your approved template." : "Delivered to the SMS provider."
                : state.data.via === "whatsapp" ? "Not sent: no WhatsApp template for this alert yet." : "Not sent: SMS isn't connected yet (waiting for the sender ID)."}
            </p>
          )}
        </div>

        <Button type="submit" disabled={pending} className="motion-press mt-5 w-full sm:w-auto">
          <Send className="size-4" aria-hidden /> {pending ? "Sending…" : "Send test"}
        </Button>
      </form>
    </div>
  );
}
