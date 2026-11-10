"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CreditCard, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PersonAvatar } from "@/components/dashboard/person-avatar";
import { assignMessage, verifyMessage, type AssignResult, type VerifyResult } from "@/lib/enrollment";
import { uidTail } from "@/lib/nfc";
import { playError, playSuccess } from "@/lib/sound";
import { CardReaderPanel } from "./card-reader-panel";
import { useCardReader } from "./use-card-reader";

type Holder = { type: "student" | "staff"; id: string; name: string; className: string | null; photoUrl: string | null };

type Step =
  | { kind: "scan" }
  | { kind: "conflict"; uid: string; text: string }
  | { kind: "linked"; uid: string; text: string }
  | { kind: "test" }
  | { kind: "verified" };

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? "Something went wrong. Please try again.");
  return json as T;
}

export function AssignCardDialog({ holder, hasCard, trigger, mode = "assign" }: { holder: Holder; hasCard: boolean; trigger?: React.ReactNode; mode?: "assign" | "test" }) {
  const initial: Step = mode === "test" ? { kind: "test" } : { kind: "scan" };
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [flash, setFlash] = useState<"error" | "success" | null>(null);

  const fail = (text: string) => {
    setMessage(text);
    setFlash("error");
    playError();
    setTimeout(() => setFlash(null), 700);
  };

  const assign = async (uid: string, confirm = false) => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await post<AssignResult>("/api/cards/assign", { uid, holder_type: holder.type, holder_id: holder.id, confirm_reassign: confirm });
      const msg = assignMessage(r);
      if (r.status === "linked" || r.status === "reassigned" || r.status === "already_linked") {
        playSuccess();
        setStep({ kind: "linked", uid, text: msg.text });
        router.refresh();
      } else if (r.status === "conflict") {
        playError();
        setStep({ kind: "conflict", uid, text: msg.text });
      } else {
        fail(msg.text);
      }
    } catch (e) {
      fail((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (uid: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await post<VerifyResult>("/api/cards/verify", { uid, holder_type: holder.type, holder_id: holder.id });
      if (r.status === "verified") {
        playSuccess();
        setStep({ kind: "verified" });
        router.refresh();
      } else {
        fail(verifyMessage(r).text);
      }
    } catch (e) {
      fail((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const listening = open && (step.kind === "scan" || step.kind === "test");
  const reader = useCardReader((uid) => (step.kind === "test" ? verify(uid) : assign(uid)), { enabled: listening && !busy });

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) {
      reader.stop();
      setStep(initial);
      setMessage(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? <Button><CreditCard className="size-4" /> {hasCard ? "Replace card" : "Assign card"}</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{step.kind === "test" ? "Test card" : hasCard ? "Replace card" : "Assign card"}</DialogTitle>
          <DialogDescription>
            {holder.name}{holder.className ? ` · ${holder.className}` : ""}. Nothing is written to the card — only its serial number is saved.
          </DialogDescription>
        </DialogHeader>

        {(step.kind === "scan" || step.kind === "test") && (
          <div className="py-2">
            <CardReaderPanel
              reader={reader}
              busy={busy}
              flash={flash}
              prompt={step.kind === "test" ? `Tap the card again to test it` : "Hold the new card near the device"}
            />
            {message && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-800">{message}</p>}
            {hasCard && step.kind === "scan" && (
              <p className="mt-4 text-center text-xs text-muted-foreground">The current card stops working as soon as the new one is linked.</p>
            )}
          </div>
        )}

        {step.kind === "conflict" && (
          <div className="space-y-4 py-2 text-center">
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-950">{step.text}</p>
            <p className="text-xs text-muted-foreground">Reassigning stops the card working for its current holder.</p>
            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={() => setStep({ kind: "scan" })}>Use a different card</Button>
              <Button onClick={() => assign(step.uid, true)} disabled={busy}>{busy ? "Reassigning…" : "Reassign card"}</Button>
            </div>
          </div>
        )}

        {step.kind === "linked" && (
          <div className="flex flex-col items-center py-2 text-center">
            <div className="relative">
              <PersonAvatar name={holder.name} src={holder.photoUrl} size="lg" />
              <CheckCircle2 className="absolute -bottom-1 -right-1 size-8 rounded-full bg-card text-success" aria-hidden />
            </div>
            <p className="mt-3 text-lg font-semibold text-ink">{holder.name}</p>
            <p className="text-sm text-muted-foreground">{holder.className ?? "Staff"} · Card ••••{uidTail(step.uid)}</p>
            <p className="mt-3 text-sm text-green-800" role="status">{step.text}</p>
            {!holder.photoUrl && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">Add a photo before testing — every card must show a face at the gate.</p>
            )}
            <div className="mt-5 flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Done for now</Button>
              <Button onClick={() => { setStep({ kind: "test" }); setMessage(null); }}>
                <ShieldCheck className="size-4" /> Test card
              </Button>
            </div>
          </div>
        )}

        {step.kind === "verified" && (
          <div className="flex flex-col items-center py-4 text-center">
            <ShieldCheck className="size-14 text-success" aria-hidden />
            <p className="mt-3 text-lg font-semibold text-ink">Card verified</p>
            <p className="text-sm text-muted-foreground">{holder.name}&apos;s card is ready to use at the gate.</p>
            <Button className="mt-5" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
