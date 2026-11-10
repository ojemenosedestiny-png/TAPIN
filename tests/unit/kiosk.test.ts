import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, MAX_QUEUE, classifyResponse, enqueue, flushQueue, loadQueue, newClientId, saveQueue, type QueuedTap } from "@/lib/offline-queue";
import { createWedgeReader } from "@/lib/keyboard-wedge";

const tap = (n: number): Omit<QueuedTap, "attempts"> => ({ client_id: `client-${n}`.padEnd(10, "x"), uid: "04A35B1C", tapped_at: `2026-11-10T07:0${n}:00Z` });

describe("offline queue", () => {
  it("keeps taps in order and caps the size", () => {
    let q: QueuedTap[] = [];
    q = enqueue(q, tap(1));
    q = enqueue(q, tap(2));
    expect(q.map((t) => t.client_id)).toEqual([tap(1).client_id, tap(2).client_id]);
    let big: QueuedTap[] = [];
    for (let i = 0; i < MAX_QUEUE + 5; i++) big = enqueue(big, { ...tap(1), client_id: `c${i}`.padEnd(10, "x") });
    expect(big).toHaveLength(MAX_QUEUE);
    expect(big[0]!.client_id).toBe("c5".padEnd(10, "x")); // oldest dropped
  });

  it("classifies responses", () => {
    expect(classifyResponse(200)).toBe("sent");
    expect(classifyResponse(null)).toBe("retry");
    expect(classifyResponse(503)).toBe("retry");
    expect(classifyResponse(429)).toBe("retry");
    expect(classifyResponse(400)).toBe("drop");
  });

  it("sends oldest first and stops at the first network failure, keeping order", async () => {
    const q = [tap(1), tap(2), tap(3)].map((t) => ({ ...t, attempts: 0 }));
    const sentIds: string[] = [];
    const r = await flushQueue(q, async (t) => {
      if (t.client_id === tap(2).client_id) return null; // offline again
      sentIds.push(t.client_id);
      return 200;
    });
    expect(sentIds).toEqual([tap(1).client_id]);
    expect(r.sent).toBe(1);
    expect(r.remaining.map((t) => t.client_id)).toEqual([tap(2).client_id, tap(3).client_id]);
    expect(r.remaining[0]!.attempts).toBe(1);
  });

  it("drops taps the server refuses, and gives up after too many retries", async () => {
    const q = [{ ...tap(1), attempts: 0 }, { ...tap(2), attempts: MAX_ATTEMPTS - 1 }, { ...tap(3), attempts: 0 }];
    const r = await flushQueue(q, async (t) => (t.client_id === tap(1).client_id ? 400 : t.client_id === tap(2).client_id ? 503 : 200));
    expect(r.dropped).toBe(2);
    expect(r.sent).toBe(1);
    expect(r.remaining).toEqual([]);
  });

  it("treats a thrown send as a network error", async () => {
    const r = await flushQueue([{ ...tap(1), attempts: 0 }], async () => { throw new Error("boom"); });
    expect(r.remaining).toHaveLength(1);
  });

  it("survives broken storage", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    saveQueue(storage, [{ ...tap(1), attempts: 0 }]);
    expect(loadQueue(storage)).toHaveLength(1);
    store.set("tapin.kiosk.queue.v1", "{not json");
    expect(loadQueue(storage)).toEqual([]);
    expect(loadQueue(undefined)).toEqual([]);
    expect(() => saveQueue({ setItem: () => { throw new Error("full"); } }, [])).not.toThrow();
  });

  it("makes unique client ids the server accepts", () => {
    const a = newClientId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(newClientId()).not.toBe(a);
  });
});

describe("USB keyboard-wedge reader", () => {
  it("reads a fast burst of hex ending in Enter", () => {
    const got: string[] = [];
    const read = createWedgeReader((u) => got.push(u));
    let t = 1000;
    for (const k of "04a35b1c") read(k, (t += 10));
    expect(read("Enter", (t += 10))).toBe(true);
    expect(got).toEqual(["04A35B1C"]);
  });
  it("ignores a person typing slowly", () => {
    const got: string[] = [];
    const read = createWedgeReader((u) => got.push(u));
    let t = 1000;
    for (const k of "04a35b1c") read(k, (t += 300));
    read("Enter", (t += 300));
    expect(got).toEqual([]);
  });
  it("ignores bursts that aren't card numbers", () => {
    const got: string[] = [];
    const read = createWedgeReader((u) => got.push(u));
    let t = 0;
    for (const k of "hello") read(k, (t += 5));
    read("Enter", (t += 5));
    for (const k of "04a3") read(k, (t += 5));
    read("Enter", (t += 5));
    expect(got).toEqual([]);
  });
});
