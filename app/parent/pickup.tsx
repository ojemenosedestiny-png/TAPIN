"use client";

import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { KeyRound, QrCode as QrIcon, UserPlus, X } from "lucide-react";
import { QrCode } from "@/components/pickup/qr-code";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { parentAddPickupPerson, parentApprovePickup, parentCreatePickupCode, parentIssueQr, parentRemovePickup, type ParentPickupState } from "./pickup-actions";

export type ParentPickupPerson = { id: string; name: string; relationship: string | null; status: string; card: boolean; children: string[] };
type Kid = { id: string; name: string };

function KidChoice({ kids }: { kids: Kid[] }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium text-ink">For</legend>
      <div className="flex flex-wrap gap-2">
        {kids.map((k) => (
          <label key={k.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-accent">
            <input type="checkbox" name="student_ids" value={k.id} defaultChecked={kids.length === 1} className="size-4 accent-[var(--brand)]" /> {k.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ParentPickup({ people, kids }: { people: ParentPickupPerson[]; kids: Kid[] }) {
  const [mode, setMode] = useState<"none" | "add" | "code">("none");
  const [busy, start] = useTransition();
  const [pass, setPass] = useState<{ qr: string; name: string } | null>(null);
  const [addState, addAction, adding] = useActionState<ParentPickupState, FormData>(async (p, fd) => {
    const r = await parentAddPickupPerson(p, fd);
    if (r.ok) { toast.success(r.ok); setMode("none"); }
    return r;
  }, {});
  const [codeState, codeAction, coding] = useActionState<ParentPickupState, FormData>(parentCreatePickupCode, {});
  const run = (fn: () => Promise<ParentPickupState>) => start(async () => {
    const r = await fn();
    if (r.ok) toast.success(r.ok); else if (r.error) toast.error(r.error);
  });

  return (
    <section className="motion-rise rounded-2xl border border-border bg-card p-5" aria-labelledby="pickup-h">
      <h2 id="pickup-h" className="font-semibold text-ink">Who can collect your children</h2>
      <p className="mt-1 text-sm text-muted-foreground">At the gate, staff see this person&apos;s photo next to your child and confirm before your child leaves. You get a message every time.</p>

      <ul className="mt-4 divide-y divide-border">
        {people.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink">{p.name}{p.relationship ? <span className="font-normal text-muted-foreground"> · {p.relationship}</span> : null}</p>
              <p className="truncate text-xs text-muted-foreground">{p.children.join(", ")} · {p.card ? "has a pickup card" : "no card yet"}</p>
            </div>
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", p.status === "pending" ? "bg-amber-100 text-amber-900" : p.status === "revoked" ? "bg-red-50 text-red-800" : "bg-success/15 text-green-800")}>
              {p.status === "pending" ? "Needs your OK" : p.status === "revoked" ? "Not allowed" : "Allowed"}
            </span>
            {p.status === "pending" && <Button size="sm" disabled={busy} onClick={() => run(() => parentApprovePickup(p.id))}>Approve</Button>}
            {p.status === "active" && (
              <Button size="sm" variant="outline" disabled={busy} aria-label={`QR pass for ${p.name}`}
                onClick={() => start(async () => { const r = await parentIssueQr(p.id); if (r.pass) setPass(r.pass); else if (r.error) toast.error(r.error); })}>
                <QrIcon className="size-4" aria-hidden />
              </Button>
            )}
            <Button size="sm" variant="ghost" className="text-red-700" disabled={busy} aria-label={`Remove ${p.name}`}
              onClick={() => { if (confirm(`Stop ${p.name} collecting your children?`)) run(() => parentRemovePickup(p.id)); }}><X className="size-4" aria-hidden /></Button>
          </li>
        ))}
        {people.length === 0 && <li className="py-3 text-sm text-muted-foreground">Nobody added yet.</li>}
      </ul>

      {pass && (
        <div className="mt-4 rounded-xl bg-muted/50 p-4 text-center" role="status">
          <p className="text-sm font-medium text-ink">QR pickup pass for {pass.name}</p>
          <div className="mt-3 flex justify-center"><QrCode value={pass.qr} size={220} label={`Pickup pass for ${pass.name}`} /></div>
          <p className="mt-2 text-xs text-muted-foreground">Screenshot it and send it to {pass.name}. At the school kiosk they choose Scan QR. Making a new pass cancels this one.</p>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setPass(null)}>Done</Button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant={mode === "add" ? "default" : "outline"} size="sm" onClick={() => setMode(mode === "add" ? "none" : "add")}><UserPlus className="size-4" aria-hidden /> Add a person</Button>
        <Button variant={mode === "code" ? "default" : "outline"} size="sm" onClick={() => setMode(mode === "code" ? "none" : "code")}><KeyRound className="size-4" aria-hidden /> One-day code</Button>
      </div>

      {mode === "add" && (
        <form action={addAction} className="mt-4 space-y-3 rounded-xl bg-muted/50 p-4" noValidate>
          {addState.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{addState.error}</p>}
          <div className="space-y-1.5"><Label htmlFor="pk-name">Full name</Label><Input id="pk-name" name="name" required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="pk-rel">Relationship</Label><Input id="pk-rel" name="relationship" placeholder="Aunt, driver…" /></div>
            <div className="space-y-1.5"><Label htmlFor="pk-phone">Phone</Label><Input id="pk-phone" name="phone" type="tel" inputMode="tel" placeholder="Optional" /></div>
          </div>
          <KidChoice kids={kids} />
          <Button type="submit" disabled={adding} className="w-full">{adding ? "Saving…" : "Allow this person"}</Button>
        </form>
      )}

      {mode === "code" && (
        codeState.code ? (
          <div className="mt-4 rounded-xl bg-muted/50 p-4 text-center">
            <p className="text-sm text-muted-foreground">Code for {codeState.code.person}, valid {codeState.code.date} only, once:</p>
            <p className="mt-2 font-heading text-4xl font-semibold tracking-[0.2em] tabular-nums text-ink">{codeState.code.code}</p>
            <div className="mt-3 flex justify-center"><QrCode value={codeState.code.qr} size={180} label="QR code for the pickup code" /></div>
            <p className="mt-2 text-xs text-muted-foreground">{codeState.ok} They enter it at the school kiosk under &ldquo;Pickup code&rdquo;.</p>
          </div>
        ) : (
          <form action={codeAction} className="mt-4 space-y-3 rounded-xl bg-muted/50 p-4" noValidate>
            {codeState.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{codeState.error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="cd-name">Who is collecting</Label><Input id="cd-name" name="person_name" required /></div>
              <div className="space-y-1.5"><Label htmlFor="cd-phone">Their phone</Label><Input id="cd-phone" name="phone" type="tel" inputMode="tel" placeholder="To text the code" /></div>
            </div>
            <div className="flex gap-2">
              {(["today", "tomorrow"] as const).map((d) => (
                <label key={d} className="flex flex-1 cursor-pointer items-center justify-center rounded-lg border border-border px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-accent">
                  <input type="radio" name="day" value={d} defaultChecked={d === "today"} className="sr-only" />{d === "today" ? "Today" : "Tomorrow"}
                </label>
              ))}
            </div>
            <KidChoice kids={kids} />
            <Button type="submit" disabled={coding} className="w-full">{coding ? "Creating…" : "Create code"}</Button>
          </form>
        )
      )}
    </section>
  );
}
