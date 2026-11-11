"use client";

import { useActionState, useState } from "react";
import { Check, Megaphone, Siren, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, useActionFeedback, type ActionState } from "@/components/forms/field";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { broadcastParents, markPerson, setEmergencyPin, startRollCall } from "./actions";

export function StartRollCall({ needsPin }: { needsPin: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(startRollCall, {});
  useActionFeedback(state, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="h-14 w-full bg-red-600 text-lg text-white hover:bg-red-700 sm:w-auto"><Siren className="size-5" aria-hidden /> Start emergency roll call</Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>Start a roll call?</DialogTitle>
            <DialogDescription>Everyone tapped in today goes on the list. Every kiosk switches to the assembly screen and marks people safe as they tap.</DialogDescription>
          </DialogHeader>
          <FormError state={state} />
          <div className="grid grid-cols-2 gap-2">
            {(["real", "drill"] as const).map((k) => (
              <label key={k} className="flex cursor-pointer items-center justify-center rounded-lg border border-border px-3 py-3 text-sm font-medium has-[:checked]:border-red-600 has-[:checked]:bg-red-50 has-[:checked]:text-red-800">
                <input type="radio" name="kind" value={k} defaultChecked={k === "real"} className="sr-only" />{k === "real" ? "Real emergency" : "Drill"}
              </label>
            ))}
          </div>
          <Field name="reason" id="em-reason" label="What happened (optional)" placeholder="Fire alarm, evacuation drill…" maxLength={200} />
          {needsPin && <Field name="pin" id="em-pin" label="Emergency PIN" type="password" inputMode="numeric" autoComplete="off" error={state.errors?.pin} />}
          <DialogFooter><Button type="submit" disabled={pending} className="bg-red-600 text-white hover:bg-red-700">{pending ? "Starting…" : "Start now"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Tick (or untick) one person. */
export function MarkButton({ id, safe, name }: { id: string; safe: boolean; name: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(markPerson, {});
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="safe" value={safe ? "0" : "1"} />
      <Button type="submit" size="sm" variant={safe ? "ghost" : "default"} disabled={pending} aria-label={safe ? `Undo: ${name} not safe yet` : `Mark ${name} safe`}
        className={cn(!safe && "min-w-24 bg-green-700 text-white hover:bg-green-800")}>
        {safe ? <Undo2 className="size-4" aria-hidden /> : <><Check className="size-4" aria-hidden /> Safe</>}
      </Button>
      {state.errors?._form && <span role="alert" className="sr-only">{state.errors._form}</span>}
    </form>
  );
}

export function BroadcastDialog({ id, defaultMessage, sent }: { id: string; defaultMessage: string; sent: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(broadcastParents, {});
  useActionFeedback(state, () => setOpen(false));
  if (sent) return <span className="text-sm text-muted-foreground">Parents messaged</span>;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><Megaphone className="size-4" aria-hidden /> Message parents</Button></DialogTrigger>
      <DialogContent>
        <form action={action} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>Message every parent on the roll</DialogTitle>
            <DialogDescription>Sent once, to the parents of every child on this roll call. Uses your SMS allowance.</DialogDescription>
          </DialogHeader>
          <input type="hidden" name="id" value={id} />
          <FormError state={state} />
          <div className="space-y-1.5">
            <Label htmlFor="em-msg">Message</Label>
            <textarea id="em-msg" name="message" rows={4} defaultValue={defaultMessage} maxLength={459}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" />
            {state.errors?.message && <p className="text-sm text-red-700">{state.errors.message}</p>}
          </div>
          <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send to parents"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PinForm({ hasPin }: { hasPin: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setEmergencyPin, {});
  useActionFeedback(state);
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormError state={state} />
      <div className="grid grid-cols-2 gap-3">
        <Field name="pin" id="pin-new" label={hasPin ? "New PIN" : "PIN"} type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} error={e.pin} />
        <Field name="confirm" id="pin-confirm" label="Repeat PIN" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} error={e.confirm} />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>{pending ? "Saving…" : hasPin ? "Change PIN" : "Set PIN"}</Button>
    </form>
  );
}
