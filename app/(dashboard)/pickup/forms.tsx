"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CreditCard, KeyRound, Nfc, Pencil, Plus, Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, useActionFeedback, type ActionState } from "@/components/forms/field";
import { Label } from "@/components/ui/label";
import { NFC_ERROR_MESSAGES, nfcSupported, startNfcScan } from "@/lib/nfc";
import { cn } from "@/lib/utils";
import { createPickupCode, linkPickupCard, savePickupPerson } from "./actions";

export type StudentOpt = { id: string; name: string; class: string | null };

/** Tick the children; type to filter (schools have hundreds). */
function ChildPicker({ students, selected, error }: { students: StudentOpt[]; selected?: string[]; error?: string }) {
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(selected ?? []));
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? students.filter((s) => s.name.toLowerCase().includes(t) || (s.class ?? "").toLowerCase().includes(t)) : students;
    // Ticked children always stay visible.
    return [...students.filter((s) => chosen.has(s.id) && !list.includes(s)), ...list].slice(0, 60);
  }, [q, students, chosen]);
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-ink">Children they may collect</legend>
      {[...chosen].map((id) => <input key={id} type="hidden" name="student_ids" value={id} />)}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or class" aria-label="Search children"
          className="h-9 w-full rounded-md border border-input bg-card pl-9 pr-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" />
      </div>
      <ul className="max-h-52 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {shown.map((s) => (
          <li key={s.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/60">
              <input type="checkbox" checked={chosen.has(s.id)} className="size-4 accent-[var(--brand)]"
                onChange={() => setChosen((c) => { const n = new Set(c); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })} />
              <span className="min-w-0 flex-1 truncate text-ink">{s.name}</span>
              {s.class && <span className="shrink-0 text-xs text-muted-foreground">{s.class}</span>}
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted-foreground">No match.</li>}
      </ul>
      <p className="text-xs text-muted-foreground">{chosen.size} chosen</p>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </fieldset>
  );
}

type PersonValues = { id: string; name: string; relationship: string | null; phone: string; student_ids: string[] };

export function PersonDialog({ students, person }: { students: StudentOpt[]; person?: PersonValues }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(savePickupPerson, {});
  useActionFeedback(state, () => setOpen(false));
  const e = state.errors ?? {};
  const key = person?.id ?? "new";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {person
          ? <Button variant="ghost" size="sm" aria-label={`Edit ${person.name}`}><Pencil className="size-4" aria-hidden /></Button>
          : <Button><UserPlus className="size-4" aria-hidden /> Add pickup person</Button>}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <form action={action} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{person ? `Edit ${person.name}` : "Add a pickup person"}</DialogTitle>
            <DialogDescription>A parent, relative or driver who may collect these children. Add their photo after saving, so staff can check their face.</DialogDescription>
          </DialogHeader>
          {person && <input type="hidden" name="id" value={person.id} />}
          <FormError state={state} />
          <Field name="name" id={`pp-name-${key}`} label="Full name" defaultValue={person?.name} error={e.name} required />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field name="relationship" id={`pp-rel-${key}`} label="Relationship" placeholder="Mother, uncle, driver…" defaultValue={person?.relationship ?? ""} error={e.relationship} />
            <Field name="phone" id={`pp-phone-${key}`} label="Phone (optional)" type="tel" inputMode="tel" placeholder="0803 123 4567" defaultValue={person?.phone} error={e.phone} />
          </div>
          <ChildPicker students={students} selected={person?.student_ids} error={e.student_ids} />
          {!person && (
            <label className="flex items-start gap-3 rounded-lg bg-muted/60 p-3 text-sm">
              <input type="checkbox" name="approved" defaultChecked className="mt-0.5 size-4 accent-[var(--brand)]" />
              <span><span className="font-medium text-ink">A parent has approved this person.</span> <span className="text-muted-foreground">Untick to wait for a parent to approve them in the parent portal.</span></span>
            </label>
          )}
          <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const noop = () => () => {};

/** Link a card: tap it on this phone (Android Chrome), or click the box and tap it on a USB reader. */
export function CardDialog({ id, name, hasCard }: { id: string; name: string; hasCard: boolean }) {
  const [open, setOpen] = useState(false);
  const [uid, setUid] = useState("");
  const [nfcMsg, setNfcMsg] = useState<string | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const supported = useSyncExternalStore(noop, nfcSupported, () => false);
  const [state, action, pending] = useActionState<ActionState, FormData>(linkPickupCard, {});
  useActionFeedback(state, () => setOpen(false));
  useEffect(() => () => stop.current?.(), []);

  const readWithPhone = async () => {
    setNfcMsg("Hold the card to the back of this phone…");
    stop.current?.();
    stop.current = await startNfcScan({
      onUid: (u) => { setUid(u); setNfcMsg("Card read."); stop.current?.(); },
      onError: (k) => { if (k !== "read_failed") setNfcMsg(NFC_ERROR_MESSAGES[k]); },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { stop.current?.(); setUid(""); setNfcMsg(null); } }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><CreditCard className="size-4" aria-hidden /> {hasCard ? "Replace card" : "Link card"}</Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>Pickup card for {name}</DialogTitle>
            <DialogDescription>Use a new card. {hasCard ? "The old card stops working straight away." : "It works at the kiosk as soon as it's linked."}</DialogDescription>
          </DialogHeader>
          <input type="hidden" name="id" value={id} />
          <FormError state={state} />
          {supported && (
            <Button type="button" variant="outline" className="w-full" onClick={() => void readWithPhone()}><Nfc className="size-4" aria-hidden /> Tap card on this phone</Button>
          )}
          {nfcMsg && <p className="text-sm text-muted-foreground" role="status">{nfcMsg}</p>}
          <Field name="uid" id={`uid-${id}`} label="Card number" value={uid} onChange={(e) => setUid(e.target.value)} autoComplete="off" spellCheck={false}
            className="font-mono" hint="Filled in when the card is read. A USB reader types it here." error={state.errors?.uid} />
          <DialogFooter><Button type="submit" disabled={pending || uid.trim().length < 8}>{pending ? "Linking…" : "Link card"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One-day code: shown once, big, so the office can read it out or it is texted. */
export function CodeDialog({ students }: { students: StudentOpt[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(createPickupCode, {});
  useActionFeedback(state);
  const e = state.errors ?? {};
  const made = state.data as { code: string; person: string; date: string } | undefined;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><KeyRound className="size-4" aria-hidden /> One-day code</Button></DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        {made ? (
          <div className="space-y-4 text-center">
            <DialogHeader><DialogTitle>Pickup code for {made.person}</DialogTitle><DialogDescription>Valid on {made.date} only, once. It won&apos;t be shown again.</DialogDescription></DialogHeader>
            <p className="font-heading text-5xl font-semibold tracking-[0.2em] text-ink tabular-nums">{made.code}</p>
            <p className="text-sm text-muted-foreground">At the kiosk: Pickup code → enter the 6 digits → staff check and release.</p>
            <DialogFooter><Button type="button" onClick={() => setOpen(false)}>Done</Button></DialogFooter>
          </div>
        ) : (
          <form action={action} className="space-y-4" noValidate>
            <DialogHeader>
              <DialogTitle>One-day pickup code</DialogTitle>
              <DialogDescription>For someone collecting once, without a card. Staff still check and confirm at the kiosk.</DialogDescription>
            </DialogHeader>
            <FormError state={state} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field name="person_name" id="code-name" label="Who is collecting" error={e.person_name} required />
              <Field name="phone" id="code-phone" label="Their phone (to text the code)" type="tel" inputMode="tel" placeholder="Optional" error={e.phone} />
            </div>
            <div className="space-y-1.5">
              <Label>Day</Label>
              <div className="flex gap-2">
                {(["today", "tomorrow"] as const).map((d) => (
                  <label key={d} className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-accent">
                    <input type="radio" name="day" value={d} defaultChecked={d === "today"} className="sr-only" />{d === "today" ? "Today" : "Tomorrow"}
                  </label>
                ))}
              </div>
            </div>
            <ChildPicker students={students} error={e.student_ids} />
            <DialogFooter><Button type="submit" disabled={pending}><Plus className="size-4" aria-hidden /> {pending ? "Creating…" : "Create code"}</Button></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function StatusDot({ status, blocked }: { status: string; blocked: boolean }) {
  const label = status === "revoked" ? "Not allowed" : status === "pending" ? "Waiting for parent" : blocked ? "Card blocked" : "Allowed";
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium",
      status === "revoked" || blocked ? "bg-red-50 text-red-800" : status === "pending" ? "bg-amber-100 text-amber-900" : "bg-success/15 text-green-800")}>{label}</span>
  );
}
