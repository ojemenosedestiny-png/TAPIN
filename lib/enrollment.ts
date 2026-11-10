/**
 * Card enrollment rules shared by the API, the single-enrol modal and class mode (build plan §10).
 * Pure functions only, so they can be unit tested.
 */

export type HolderLabel = { name: string; class: string | null; photo_url?: string | null };

/** What assign_card() returns. */
export type AssignResult =
  | { status: "linked" | "reassigned"; card_id: string; replaced_card_id: string | null; holder: HolderLabel }
  | { status: "already_linked"; card_id: string; verified: boolean }
  | { status: "conflict"; card_id: string; card_status: "active" | "blocked" | "replaced"; holder: HolderLabel; same_holder: boolean }
  | { status: "other_school" | "race_conflict" | "invalid_uid" | "holder_not_found" };

export type VerifyResult =
  | { status: "verified"; card_id: string; verified_at: string }
  | { status: "wrong_person"; holder: HolderLabel }
  | { status: "unknown_card" | "photo_required" };

/** Admin-facing message for an assign outcome. */
export function assignMessage(r: AssignResult): { tone: "success" | "warning" | "error"; text: string } {
  switch (r.status) {
    case "linked":
      return { tone: "success", text: r.replaced_card_id ? "New card linked. The old card has been retired." : "Card linked." };
    case "reassigned":
      return { tone: "success", text: "Card reassigned." };
    case "already_linked":
      return { tone: "success", text: r.verified ? "This card is already linked to this person." : "This card is already linked. Test it to verify." };
    case "conflict": {
      const who = `${r.holder.name}${r.holder.class ? ` (${r.holder.class})` : ""}`;
      if (r.same_holder) return { tone: "warning", text: `This is ${who}'s old ${r.card_status} card. Reactivate it?` };
      const state = r.card_status === "active" ? "belongs to" : `was ${r.card_status} for`;
      return { tone: "warning", text: `This card ${state} ${who}. Reassign?` };
    }
    case "other_school":
      return { tone: "error", text: "This card is registered at another school and can't be used here." };
    case "race_conflict":
      return { tone: "error", text: "Someone else just linked this card. Tap it again to see who has it." };
    case "invalid_uid":
      return { tone: "error", text: "That doesn't look like a card number. Tap the card again." };
    case "holder_not_found":
      return { tone: "error", text: "This person isn't an active student or staff member any more." };
  }
}

export function verifyMessage(r: VerifyResult): { tone: "success" | "error"; text: string } {
  switch (r.status) {
    case "verified":
      return { tone: "success", text: "Card verified. It's ready to use at the gate." };
    case "wrong_person":
      return { tone: "error", text: `That card belongs to ${r.holder.name}. Tap the card you just linked.` };
    case "unknown_card":
      return { tone: "error", text: "That card isn't linked to anyone. Tap the card you just linked." };
    case "photo_required":
      return { tone: "error", text: "Add a photo first. Every card must show a face at the gate." };
  }
}

// ---------------------------------------------------------------------------
// Class enrollment queue
// ---------------------------------------------------------------------------

export type QueueStudent = { id: string; name: string; photoUrl: string | null };
export type QueueEntry =
  | { kind: "enrolled"; studentId: string; cardId: string; uidTail: string; replacedCardId: string | null }
  | { kind: "skipped"; studentId: string };

export type ClassQueue = {
  students: QueueStudent[];
  index: number; // next student to enrol
  history: QueueEntry[]; // one per processed student, in order
  failures: { studentId: string; message: string }[]; // rejected taps (queue did not move)
};

export function createQueue(students: QueueStudent[]): ClassQueue {
  return { students, index: 0, history: [], failures: [] };
}

export function currentStudent(q: ClassQueue): QueueStudent | null {
  return q.students[q.index] ?? null;
}

export function isDone(q: ClassQueue): boolean {
  return q.index >= q.students.length;
}

export function recordEnrolled(q: ClassQueue, card: { cardId: string; uidTail: string; replacedCardId: string | null }): ClassQueue {
  const s = currentStudent(q);
  if (!s) return q;
  return { ...q, index: q.index + 1, history: [...q.history, { kind: "enrolled", studentId: s.id, ...card }] };
}

export function skip(q: ClassQueue): ClassQueue {
  const s = currentStudent(q);
  if (!s) return q;
  return { ...q, index: q.index + 1, history: [...q.history, { kind: "skipped", studentId: s.id }] };
}

/** A rejected tap: record it, but the queue does not move. */
export function recordFailure(q: ClassQueue, message: string): ClassQueue {
  const s = currentStudent(q);
  if (!s) return q;
  return { ...q, failures: [...q.failures, { studentId: s.id, message }] };
}

/** Steps back one student. Returns the entry undone, so the caller can unlink an enrolled card. */
export function undo(q: ClassQueue): { queue: ClassQueue; undone: QueueEntry | null } {
  if (!q.history.length) return { queue: q, undone: null };
  const undone = q.history[q.history.length - 1];
  return { queue: { ...q, index: q.index - 1, history: q.history.slice(0, -1) }, undone };
}

export function summary(q: ClassQueue) {
  const enrolled = q.history.filter((h): h is Extract<QueueEntry, { kind: "enrolled" }> => h.kind === "enrolled");
  const skipped = q.history.filter((h) => h.kind === "skipped");
  const enrolledIds = new Set(enrolled.map((e) => e.studentId));
  // A student counts as failed if they had a rejected tap and did not end up enrolled.
  const failedIds = new Set(q.failures.map((f) => f.studentId).filter((id) => !enrolledIds.has(id)));
  return {
    enrolled,
    skipped,
    failed: [...failedIds],
    remaining: Math.max(0, q.students.length - q.index),
  };
}
