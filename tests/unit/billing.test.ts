import { describe, expect, it } from "vitest";
import { invoiceLines, invoiceNumber, monthLabel, naira, toPeriod } from "@/lib/billing";

const pricing = { price_per_student: 500, setup_fee: 250_000, price_per_sms: 0 };

describe("invoices", () => {
  it("first invoice: setup fee plus students; SMS included at 0", () => {
    const { lines, total } = invoiceLines(pricing, { active_students: 412, sms_sent: 9000 }, { period: "2026-11-01", firstInvoice: true });
    expect(lines.map((l) => [l.quantity, l.unit_price, l.amount])).toEqual([[1, 250_000, 250_000], [412, 500, 206_000]]);
    expect(lines[1]!.description).toBe("Attendance and alerts, November 2026 (per active student)");
    expect(total).toBe(456_000);
  });

  it("later invoices: no setup fee; SMS charged when priced", () => {
    const { lines, total } = invoiceLines({ ...pricing, price_per_sms: 4.5 }, { active_students: 10, sms_sent: 333 }, { period: "2026-12-01", firstInvoice: false });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ quantity: 333, unit_price: 4.5, amount: 1498.5 });
    expect(total).toBe(6498.5);
  });

  it("totals are exact to the kobo and add up from the lines", () => {
    const { lines, total } = invoiceLines({ price_per_student: 333.33, setup_fee: 0, price_per_sms: 3.07 }, { active_students: 3, sms_sent: 7 }, { period: "2026-11-01", firstInvoice: false });
    expect(lines.map((l) => l.amount)).toEqual([999.99, 21.49]);
    expect(total).toBe(1021.48);
  });

  it("an empty month is a zero invoice with no lines", () => {
    expect(invoiceLines(pricing, { active_students: 0, sms_sent: 0 }, { period: "2026-11-01", firstInvoice: false })).toEqual({ lines: [], total: 0 });
  });

  it("numbers and labels", () => {
    expect(invoiceNumber("TAP", "2026-11-01", 7)).toBe("TAP-202611-007");
    expect(monthLabel("2026-11-01")).toBe("November 2026");
    expect(naira(456000)).toBe("₦456,000.00");
    expect(toPeriod("2026-11")).toBe("2026-11-01");
    expect(toPeriod("2026-13")).toBeNull();
    expect(toPeriod("junk")).toBeNull();
  });
});
