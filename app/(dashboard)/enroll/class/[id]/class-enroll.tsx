"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, Printer, SkipForward, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/dashboard/person-avatar";
import { CardReaderPanel } from "@/components/enroll/card-reader-panel";
import { useCardReader } from "@/components/enroll/use-card-reader";
import {
  assignMessage, createQueue, currentStudent, isDone, recordEnrolled, recordFailure, skip, summary, undo,
  type AssignResult, type ClassQueue,
} from "@/lib/enrollment";
import { uidTail } from "@/lib/nfc";
import { playError, playSuccess } from "@/lib/sound";

type Student = { id: string; name: string; admissionNo: string; photoUrl: string | null };

export function ClassEnroll({ className, classId, students }: { className: string; classId: string; students: Student[] }) {
  const [queue, setQueue] = useState<ClassQueue>(() => createQueue(students.map((s) => ({ id: s.id, name: s.name, photoUrl: s.photoUrl }))));
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<"error" | "success" | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const byId = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const current = currentStudent(queue);
  const finished = isDone(queue);

  const flashFor = (kind: "error" | "success") => {
    setFlash(kind);
    setTimeout(() => setFlash(null), 600);
  };

  const onUid = async (uid: string) => {
    if (!current || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cards/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Class mode never reassigns: a card in use is rejected and the queue stays put.
        body: JSON.stringify({ uid, holder_type: "student", holder_id: current.id, confirm_reassign: false }),
      });
      const r = (await res.json()) as AssignResult & { error?: string };
      if (!res.ok) throw new Error(r.error ?? "Could not link the card.");
      if (r.status === "linked" || r.status === "reassigned") {
        playSuccess();
        flashFor("success");
        setMessage({ tone: "success", text: `Linked to ${current.name} (••••${uidTail(uid)})` });
        setQueue((q) => recordEnrolled(q, { cardId: r.card_id, uidTail: uidTail(uid), replacedCardId: r.replaced_card_id }));
      } else if (r.status === "already_linked") {
        playSuccess();
        setQueue((q) => recordEnrolled(q, { cardId: r.card_id, uidTail: uidTail(uid), replacedCardId: null }));
      } else {
        const text = r.status === "conflict" ? `Card already in use: ${r.holder.name}${r.holder.class ? ` (${r.holder.class})` : ""}. Use a new card.` : assignMessage(r).text;
        playError();
        flashFor("error");
        setMessage({ tone: "error", text });
        setQueue((q) => recordFailure(q, text));
      }
    } catch (e) {
      playError();
      flashFor("error");
      setMessage({ tone: "error", text: (e as Error).message });
      setQueue((q) => recordFailure(q, (e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const reader = useCardReader(onUid, { enabled: !finished && !busy });

  const onUndo = async () => {
    const { queue: next, undone } = undo(queue);
    if (!undone) return;
    if (undone.kind === "enrolled") {
      setBusy(true);
      const res = await fetch("/api/cards/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_id: undone.cardId, replaced_card_id: undone.replacedCardId }),
      });
      setBusy(false);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? "Could not undo.");
        return;
      }
      toast.success(`Card ••••${undone.uidTail} unlinked.`);
    }
    setMessage(null);
    setQueue(next);
  };

  const sum = summary(queue);
  const progress = students.length ? Math.round((queue.index / students.length) * 100) : 100;

  if (students.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 text-center shadow-sm">
        <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden />
        <h1 className="mt-3 text-2xl font-semibold text-ink">Everyone in {className} has a card</h1>
        <Button asChild className="mt-6"><Link href="/enroll">Choose another class</Link></Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 print:hidden">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-semibold text-ink sm:text-3xl">{className} — card enrollment</h1>
          <span className="text-sm tabular-nums text-muted-foreground">{Math.min(queue.index + (finished ? 0 : 1), students.length)} of {students.length}</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Enrollment progress">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {!finished && current ? (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-10 print:hidden">
          <div className="flex flex-col items-center text-center">
            <PersonAvatar name={current.name} src={current.photoUrl} size="xl" />
            <p className="mt-4 text-sm text-muted-foreground">Tap a card for</p>
            <p className="text-3xl font-semibold text-ink sm:text-4xl" aria-live="polite">{current.name}</p>
            <p className="text-sm tabular-nums text-muted-foreground">{byId.get(current.id)?.admissionNo}</p>
          </div>
          <div className="mt-8">
            <CardReaderPanel reader={reader} busy={busy} flash={flash} prompt="Hold the card near the device" />
          </div>
          {message && (
            <p role={message.tone === "error" ? "alert" : "status"} className={`mt-4 rounded-lg px-4 py-3 text-center text-sm ${message.tone === "error" ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"}`}>
              {message.text}
            </p>
          )}
          <div className="mt-6 flex justify-center gap-3">
            <Button variant="outline" onClick={onUndo} disabled={busy || queue.history.length === 0}><Undo2 className="size-4" /> Undo</Button>
            <Button variant="outline" onClick={() => { setMessage(null); setQueue(skip); }} disabled={busy}><SkipForward className="size-4" /> Skip</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm print:hidden">
            <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden />
            <h2 className="mt-3 text-xl font-semibold text-ink">{className} done</h2>
            <p className="mt-1 text-sm tabular-nums text-muted-foreground">{sum.enrolled.length} enrolled · {sum.skipped.length} skipped · {sum.failed.length} failed</p>
            <div className="mt-5 flex justify-center gap-2">
              <Button variant="outline" onClick={onUndo} disabled={busy || queue.history.length === 0}><Undo2 className="size-4" /> Undo last</Button>
              <Button variant="outline" onClick={() => window.print()}><Printer className="size-4" /> Print list</Button>
              <Button asChild variant="outline"><Link href={`/cards/print?class=${classId}`}><Printer className="size-4" /> Print ID cards</Link></Button>
              <Button asChild><Link href="/enroll">Next class</Link></Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">Cards still need a Test tap from each student&apos;s profile to be marked verified.</p>
          </div>

          {/* Printable list for the ID card printer */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm print:border-0 print:p-0 print:shadow-none">
            <h2 className="text-lg font-semibold text-ink">{className} — enrolled cards</h2>
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr><th scope="col" className="py-2 font-medium">Admission no.</th><th scope="col" className="py-2 font-medium">Name</th><th scope="col" className="py-2 font-medium">Card</th><th scope="col" className="py-2 font-medium">Result</th></tr>
              </thead>
              <tbody>
                {queue.history.map((h) => {
                  const s = byId.get(h.studentId)!;
                  return (
                    <tr key={h.studentId} className="border-t border-border">
                      <td className="py-2 tabular-nums">{s.admissionNo}</td>
                      <td className="py-2 text-ink">{s.name}</td>
                      <td className="py-2 font-mono">{h.kind === "enrolled" ? `••••${h.uidTail}` : "—"}</td>
                      <td className="py-2">{h.kind === "enrolled" ? "Enrolled" : sum.failed.includes(h.studentId) ? "Failed" : "Skipped"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
