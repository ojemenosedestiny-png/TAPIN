import { describe, expect, it } from "vitest";
import { canMove, orderInvoiceNumber, orderLines, MAX_QTY } from "@/lib/school-orders";

const items = [
  { id: "card", name: "Standard NFC card", unit: "per card", unit_price: 1500 },
  { id: "kiosk", name: "Kiosk setup", unit: "per kiosk", unit_price: 250000.5 },
  { id: "free", name: "Free thing", unit: "each", unit_price: 0 },
];

describe("school orders", () => {
  it("adds up the chosen items and leaves out the rest", () => {
    const { lines, total } = orderLines(items, { card: 40, kiosk: 1, free: 3 });
    expect(lines).toEqual([
      { item_id: "card", description: "Standard NFC card (per card)", quantity: 40, unit_price: 1500, amount: 60000 },
      { item_id: "kiosk", description: "Kiosk setup (per kiosk)", quantity: 1, unit_price: 250000.5, amount: 250000.5 },
    ]);
    expect(total).toBe(310000.5);
  });
  it("ignores nonsense quantities and caps huge ones", () => {
    expect(orderLines(items, { card: -3, kiosk: 0.5 }).lines).toEqual([]);
    expect(orderLines(items, { card: Number.NaN }).total).toBe(0);
    expect(orderLines(items, { card: 999999 }).lines[0]!.quantity).toBe(MAX_QTY);
    expect(orderLines(items, { card: 2.9 }).lines[0]!.quantity).toBe(2);
  });
  it("numbers order invoices apart from monthly ones", () => {
    expect(orderInvoiceNumber("TAP", "2026-11-01", 4)).toBe("TAP-O202611-004");
  });
  it("a school can only cancel before paying; only TapIn marks paid and delivered", () => {
    expect(canMove("awaiting_payment", "cancelled", "school")).toBe(true);
    expect(canMove("paid", "cancelled", "school")).toBe(false);
    expect(canMove("awaiting_payment", "paid", "school")).toBe(false);
    expect(canMove("awaiting_payment", "paid", "super")).toBe(true);
    expect(canMove("paid", "delivered", "super")).toBe(true);
    expect(canMove("awaiting_payment", "delivered", "super")).toBe(false);
    expect(canMove("delivered", "cancelled", "super")).toBe(false);
  });
});
