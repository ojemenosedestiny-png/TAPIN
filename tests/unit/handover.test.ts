import { describe, expect, it } from "vitest";
import {
  CODE_LOCK_AFTER, CODE_LOCK_MS, HANDOVER_MS, afterWrongCode, busArrivalMessage, busDepartureMessage, codeCollectedMessage, codeLocked,
  dropoffByMessage, dropoffMessage, handoverMode, isOpen, latePickupMessage, noParentNotice, refusedNotice, windowExpiry,
} from "@/lib/handover";

describe("parent handover rules", () => {
  it("bus children tap alone; parent-pickup children hand over only when the school turned it on", () => {
    expect(handoverMode({ transport: "bus", handoverEnabled: true })).toBe("bus");
    expect(handoverMode({ transport: "parent", handoverEnabled: true })).toBe("handover");
    expect(handoverMode({ transport: "parent", handoverEnabled: false })).toBe("alone");
    expect(handoverMode({ transport: null, handoverEnabled: true })).toBe("handover");
  });

  it("opens a two-minute window and knows when it has closed", () => {
    const start = new Date("2026-11-16T06:42:00Z");
    expect(windowExpiry(start).getTime() - start.getTime()).toBe(HANDOVER_MS);
    const h = { status: "waiting", expires_at: windowExpiry(start).toISOString() };
    expect(isOpen(h, new Date(start.getTime() + 60_000))).toBe(true);
    expect(isOpen(h, new Date(start.getTime() + HANDOVER_MS))).toBe(false);
    expect(isOpen({ ...h, status: "matched" }, start)).toBe(false);
  });

  it("locks code entry after five wrong codes, for fifteen minutes", () => {
    const now = new Date("2026-11-16T14:00:00Z");
    let s = { failures: 0, lockedUntil: null as Date | null };
    for (let i = 1; i < CODE_LOCK_AFTER; i++) {
      s = afterWrongCode(s.failures, now);
      expect(s).toEqual({ failures: i, lockedUntil: null });
    }
    s = afterWrongCode(s.failures, now);
    expect(s.failures).toBe(0);
    expect(s.lockedUntil!.getTime() - now.getTime()).toBe(CODE_LOCK_MS);
    expect(codeLocked(s.lockedUntil!.toISOString(), now)).toBe(true);
    expect(codeLocked(s.lockedUntil!.toISOString(), new Date(now.getTime() + CODE_LOCK_MS))).toBe(false);
    expect(codeLocked(null, now)).toBe(false);
  });

  it("writes the parent messages in the spec's words", () => {
    const base = { child: "Ada Obi", time: "7:42 AM", school: "Bright Stars" };
    expect(dropoffMessage(base)).toBe("Bright Stars: Ada Obi has checked in at 7:42 AM.");
    expect(dropoffByMessage({ ...base, by: "Ngozi Eze" })).toBe("Bright Stars: Ada Obi has checked in at 7:42 AM, dropped off by Ngozi Eze.");
    expect(busArrivalMessage(base)).toBe("Bright Stars: Ada Obi has arrived at school at 7:42 AM.");
    expect(busDepartureMessage({ ...base, time: "2:10 PM" })).toBe("Bright Stars: Ada Obi has left school on the bus at 2:10 PM.");
    expect(codeCollectedMessage({ ...base, time: "2:30 PM" })).toBe("Bright Stars: Ada Obi was collected with your pickup code at 2:30 PM.");
    expect(codeCollectedMessage({ ...base, time: "2:30 PM", by: "Aunty Bisi" })).toBe("Bright Stars: Ada Obi was collected with your pickup code at 2:30 PM by Aunty Bisi.");
    expect(latePickupMessage({ ...base, time: "3:30 PM", closing: "3:00 PM" })).toMatch(/^Bright Stars: Ada Obi is still at school at 3:30 PM\. School closed at 3:00 PM\./);
    expect(refusedNotice({ picker: "John Doe", child: "Ada Obi", place: "Main gate", time: "3:05 PM" })).toBe("John Doe tried to collect Ada Obi at Main gate, 3:05 PM, but is not linked to them. The child was not released.");
    expect(noParentNotice({ child: "Ada Obi", className: "JSS 1", time: "7:42 AM" })).toBe("Ada Obi (JSS 1) signed in at 7:42 AM, but no parent tapped to hand them over.");
  });
});
