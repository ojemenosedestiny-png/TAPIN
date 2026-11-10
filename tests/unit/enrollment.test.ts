import { describe, expect, it } from "vitest";
import {
  assignMessage, createQueue, currentStudent, isDone, recordEnrolled, recordFailure, skip, summary, undo, verifyMessage,
} from "@/lib/enrollment";

const students = [
  { id: "s1", name: "Chioma Okafor", photoUrl: null },
  { id: "s2", name: "David Bello", photoUrl: null },
  { id: "s3", name: "Amaka Eze", photoUrl: null },
];
const card = (n: number) => ({ cardId: `c${n}`, uidTail: `000${n}`, replacedCardId: null });

describe("class enrollment queue", () => {
  it("moves to the next student after each link", () => {
    let q = createQueue(students);
    expect(currentStudent(q)?.id).toBe("s1");
    q = recordEnrolled(q, card(1));
    expect(currentStudent(q)?.id).toBe("s2");
  });

  it("does not move when a card is rejected", () => {
    let q = createQueue(students);
    q = recordFailure(q, "Card already in use");
    expect(currentStudent(q)?.id).toBe("s1");
    expect(q.failures).toHaveLength(1);
  });

  it("skips and undoes", () => {
    let q = createQueue(students);
    q = recordEnrolled(q, card(1));
    q = skip(q);
    expect(currentStudent(q)?.id).toBe("s3");
    const r1 = undo(q);
    expect(r1.undone).toEqual({ kind: "skipped", studentId: "s2" });
    expect(currentStudent(r1.queue)?.id).toBe("s2");
    const r2 = undo(r1.queue);
    expect(r2.undone).toMatchObject({ kind: "enrolled", studentId: "s1", cardId: "c1" });
    expect(currentStudent(r2.queue)?.id).toBe("s1");
    expect(undo(r2.queue).undone).toBeNull();
  });

  it("finishes and summarises enrolled, skipped and failed", () => {
    let q = createQueue(students);
    q = recordFailure(q, "in use"); // s1 fails once…
    q = recordEnrolled(q, card(1)); // …then succeeds: not counted as failed
    q = recordFailure(q, "in use"); // s2 fails
    q = skip(q); // and is skipped
    q = recordEnrolled(q, card(3));
    expect(isDone(q)).toBe(true);
    expect(currentStudent(q)).toBeNull();
    const s = summary(q);
    expect(s.enrolled.map((e) => e.studentId)).toEqual(["s1", "s3"]);
    expect(s.skipped.map((e) => e.studentId)).toEqual(["s2"]);
    expect(s.failed).toEqual(["s2"]);
    expect(s.remaining).toBe(0);
  });

  it("ignores actions once done", () => {
    let q = createQueue([students[0]!]);
    q = recordEnrolled(q, card(1));
    expect(recordEnrolled(q, card(2))).toBe(q);
    expect(skip(q)).toBe(q);
    expect(recordFailure(q, "x")).toBe(q);
  });
});

describe("enrollment messages", () => {
  it("names the current holder on conflict (build plan wording)", () => {
    const m = assignMessage({
      status: "conflict", card_id: "c", card_status: "active", same_holder: false, holder: { name: "David Bello", class: "JSS1B" },
    });
    expect(m).toEqual({ tone: "warning", text: "This card belongs to David Bello (JSS1B). Reassign?" });
  });
  it("explains replaced and blocked cards", () => {
    expect(assignMessage({ status: "conflict", card_id: "c", card_status: "blocked", same_holder: false, holder: { name: "A B", class: null } }).text)
      .toBe("This card was blocked for A B. Reassign?");
    expect(assignMessage({ status: "conflict", card_id: "c", card_status: "replaced", same_holder: true, holder: { name: "A B", class: "JSS1A" } }).text)
      .toMatch(/old replaced card/);
  });
  it("never leaks other schools' details", () => {
    expect(assignMessage({ status: "other_school" }).text).toMatch(/another school/);
  });
  it("mentions a retired old card on replacement", () => {
    expect(assignMessage({ status: "linked", card_id: "c", replaced_card_id: "old", holder: { name: "A", class: null } }).text).toMatch(/old card has been retired/);
  });
  it("requires a photo before verifying", () => {
    expect(verifyMessage({ status: "photo_required" }).text).toMatch(/Add a photo/);
    expect(verifyMessage({ status: "wrong_person", holder: { name: "David Bello", class: "JSS1B" } }).text).toMatch(/David Bello/);
  });
});
