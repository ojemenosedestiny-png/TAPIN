import { describe, expect, it } from "vitest";
import { assistantDisplay, assistantLink, shareMessage } from "@/lib/assistant-number";

describe("TapIn WhatsApp number for parents", () => {
  it("opens a chat with hi already typed", () => {
    expect(assistantLink("2349167080638")).toBe("https://wa.me/2349167080638?text=hi");
    expect(assistantLink("+234 916 708 0638")).toBe("https://wa.me/2349167080638?text=hi");
  });
  it("shows the number the Nigerian way", () => {
    expect(assistantDisplay("2349167080638")).toBe("0916 708 0638");
  });
  it("gives the school a ready message with the number, what parents can do, and the link", () => {
    const m = shareMessage("Greenfield Academy", "2349167080638");
    expect(m).toContain("Greenfield Academy now uses TapIn");
    expect(m).toContain("0916 708 0638");
    expect(m).toContain("Report a sick day");
    expect(m).toContain("https://wa.me/2349167080638?text=hi");
  });
});
