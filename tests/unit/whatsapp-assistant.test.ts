import { describe, expect, it } from "vitest";
import { inSession, menuText, parseCommand, parseInbound } from "@/lib/whatsapp-assistant";

describe("parseCommand", () => {
  it("understands numbers and words", () => {
    expect(parseCommand("1")).toBe("attendance");
    expect(parseCommand("Attendance please")).toBe("attendance");
    expect(parseCommand("2")).toBe("absences");
    expect(parseCommand("absent days?")).toBe("absences");
    expect(parseCommand("3")).toBe("pickup");
    expect(parseCommand("Pick up")).toBe("pickup");
    expect(parseCommand("4")).toBe("fees");
    expect(parseCommand("FEES")).toBe("fees");
    expect(parseCommand("5")).toBe("guardians");
    expect(parseCommand("Who can collect")).toBe("guardians");
    expect(parseCommand("Hi!")).toBe("menu");
    expect(parseCommand("Good morning")).toBe("menu");
    expect(parseCommand("0")).toBe("menu");
    expect(parseCommand("what is the weather")).toBeNull();
    expect(parseCommand("   ")).toBeNull();
  });
  it("shows fees only when the school uses them", () => {
    expect(menuText("Ngozi", true)).toContain("4 Fees");
    expect(menuText(null, false)).not.toContain("Fees");
  });
});

describe("parseInbound", () => {
  it("reads Meta's Cloud API format", () => {
    const body = { entry: [{ changes: [{ value: { messages: [{ from: "2348031234567", id: "wamid.1", type: "text", text: { body: "1" } }] } }] }] };
    expect(parseInbound(body)).toEqual([{ phone: "2348031234567", text: "1", id: "wamid.1" }]);
  });
  it("reads flat provider formats", () => {
    expect(parseInbound({ sender: "2348031234567", message: "Hi", message_id: "abc" })).toEqual([{ phone: "2348031234567", text: "Hi", id: "abc" }]);
    expect(parseInbound({ data: { from: "+2348031234567", text: "2" } })).toEqual([{ phone: "+2348031234567", text: "2", id: null }]);
    expect(parseInbound({ status: "delivered" })).toEqual([]);
    expect(parseInbound(null)).toEqual([]);
  });
  it("knows the 24-hour reply window", () => {
    const now = new Date("2026-11-12T12:00:00Z");
    expect(inSession(new Date("2026-11-12T00:00:00Z"), now)).toBe(true);
    expect(inSession(new Date("2026-11-11T11:00:00Z"), now)).toBe(false);
    expect(inSession(null, now)).toBe(false);
  });
});
