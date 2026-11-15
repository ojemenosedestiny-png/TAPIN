import { describe, expect, it } from "vitest";
import { addMonths, computeQuote, nextRenewal, paidMonths, planForStudents, quoteNumber, renewalAmount, studentRange, subscriptionStatus } from "@/lib/subscriptions";

const items = [
  { id: "k", name: "Kiosk setup", unit: "per kiosk", unit_price: 250_000, quantity: 2 },
  { id: "c", name: "Standard NFC card", unit: "per card", unit_price: 1_500, quantity: 400 },
  { id: "w", name: "Premium NFC wristband", unit: "per wristband", unit_price: 3_500, quantity: 0 },
];

describe("quotes", () => {
  it("adds setup items and the first month", () => {
    const q = computeQuote({ items, monthlyPrice: 120_000, billing: "monthly", annualFreeMonths: 2, discount: null });
    expect(q.lines.map((l) => [l.name, l.quantity, l.amount])).toEqual([["Kiosk setup", 2, 500_000], ["Standard NFC card", 400, 600_000]]);
    expect(q.setupTotal).toBe(1_100_000);
    expect(q.periodFee).toBe(120_000);
    expect(q.periodLabel).toBe("First month");
    expect(q.firstPayment).toBe(1_220_000);
  });

  it("bills a year less the free months when paying yearly", () => {
    const q = computeQuote({ items, monthlyPrice: 120_000, billing: "annual", annualFreeMonths: 2, discount: null });
    expect(q.periodFee).toBe(1_200_000); // 10 months
    expect(q.periodLabel).toBe("First year (12 months, 2 free)");
    expect(q.firstPayment).toBe(2_300_000);
  });

  it("takes a percentage or a fixed discount off the first payment, never below zero", () => {
    expect(computeQuote({ items, monthlyPrice: 120_000, billing: "monthly", annualFreeMonths: 0, discount: { kind: "percent", value: 10 } }))
      .toMatchObject({ subtotal: 1_220_000, discountAmount: 122_000, firstPayment: 1_098_000 });
    expect(computeQuote({ items, monthlyPrice: 120_000, billing: "monthly", annualFreeMonths: 0, discount: { kind: "fixed", value: 100_000 } }).firstPayment).toBe(1_120_000);
    expect(computeQuote({ items: [], monthlyPrice: 50_000, billing: "monthly", annualFreeMonths: 0, discount: { kind: "fixed", value: 90_000 } }))
      .toMatchObject({ discountAmount: 50_000, firstPayment: 0 });
    expect(computeQuote({ items: [], monthlyPrice: 50_000, billing: "monthly", annualFreeMonths: 0, discount: { kind: "percent", value: 150 } }).firstPayment).toBe(0);
  });

  it("numbers quotes by year", () => {
    expect(quoteNumber(2026, 42)).toBe("Q-2026-0042");
  });
});

describe("plans", () => {
  const plans = [
    { name: "Starter", min_students: 0, max_students: 300, active: true, sort: 1 },
    { name: "Standard", min_students: 301, max_students: 800, active: true, sort: 2 },
    { name: "Premium", min_students: 801, max_students: null, active: true, sort: 3 },
    { name: "Old", min_students: 0, max_students: 10_000, active: false, sort: 0 },
  ];
  it("finds the plan for a school's size, ignoring retired plans", () => {
    expect(planForStudents(plans, 120)?.name).toBe("Starter");
    expect(planForStudents(plans, 301)?.name).toBe("Standard");
    expect(planForStudents(plans, 5000)?.name).toBe("Premium");
  });
  it("describes the student range", () => {
    expect(studentRange(301, 800)).toBe("301–800 students");
    expect(studentRange(801, null)).toBe("801+ students");
  });
  it("counts the months paid for", () => {
    expect(paidMonths("monthly", 2)).toBe(1);
    expect(paidMonths("annual", 2)).toBe(10);
    expect(paidMonths("annual", 0)).toBe(12);
    expect(paidMonths("annual", 99)).toBe(6); // at most six free months
    expect(renewalAmount(100_000, "annual", 2)).toBe(1_000_000);
  });
});

describe("subscriptions", () => {
  it("renews a month or a year later, keeping the day where it exists", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-15", 2)).toBe("2027-01-15");
    expect(nextRenewal("2026-11-15", "monthly")).toBe("2026-12-15");
    expect(nextRenewal("2026-11-15", "annual")).toBe("2027-11-15");
  });
  it("is active, due within 7 days, overdue after the date, or suspended", () => {
    expect(subscriptionStatus("2026-12-15", false, "2026-11-15")).toBe("active");
    expect(subscriptionStatus("2026-11-22", false, "2026-11-15")).toBe("due");
    expect(subscriptionStatus("2026-11-15", false, "2026-11-15")).toBe("due");
    expect(subscriptionStatus("2026-11-14", false, "2026-11-15")).toBe("overdue");
    expect(subscriptionStatus("2026-12-15", true, "2026-11-15")).toBe("suspended");
  });
});
