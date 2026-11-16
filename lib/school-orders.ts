/**
 * A school ordering more cards, wristbands or kiosks. The school pays, by invoice. Pure rules, unit tested.
 * Prices come from the super admin's Pricing page (active setup items above ₦0), read on the server.
 */
import { round2 } from "@/lib/subscriptions";

export type OrderItem = { id: string; name: string; unit: string; unit_price: number };
export type OrderLine = { item_id: string; description: string; quantity: number; unit_price: number; amount: number };
export type OrderStatus = "awaiting_payment" | "paid" | "delivered" | "cancelled";

export const MAX_QTY = 5000;

/** Lines for the quantities chosen (whole numbers, 1 to MAX_QTY); items not chosen are left out. */
export function orderLines(items: OrderItem[], qty: Record<string, number>): { lines: OrderLine[]; total: number } {
  const lines = items.flatMap((i) => {
    const q = Math.floor(qty[i.id] ?? 0);
    if (!Number.isFinite(q) || q < 1 || i.unit_price <= 0) return [];
    const quantity = Math.min(MAX_QTY, q);
    return [{ item_id: i.id, description: `${i.name} (${i.unit})`, quantity, unit_price: round2(i.unit_price), amount: round2(quantity * i.unit_price) }];
  });
  return { lines, total: round2(lines.reduce((a, l) => a + l.amount, 0)) };
}

/** TAP-O202611-004: the invoice prefix, O for order, the month, and a running number. */
export function orderInvoiceNumber(prefix: string, period: string, seq: number): string {
  return `${prefix}-O${period.slice(0, 4)}${period.slice(5, 7)}-${String(seq).padStart(3, "0")}`;
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  awaiting_payment: "Awaiting payment", paid: "Paid, preparing", delivered: "Delivered", cancelled: "Cancelled",
};

/** Who may move an order where. The school can only cancel before paying. */
export function canMove(from: OrderStatus, to: OrderStatus, by: "school" | "super"): boolean {
  if (by === "school") return from === "awaiting_payment" && to === "cancelled";
  return (from === "awaiting_payment" && (to === "paid" || to === "cancelled")) || (from === "paid" && to === "delivered");
}
