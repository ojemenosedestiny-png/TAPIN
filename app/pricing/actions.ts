"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimitShared } from "@/lib/rate-limit-shared";
import { normaliseNgPhone } from "@/lib/phone";
import { emailSchema, fieldErrors } from "@/lib/validation";
import { naira, quoteFor, type PlanId } from "@/lib/pricing";
import { loadPricing } from "@/lib/pricing-data";
import { flutterwaveKey, initializePayment, newReference } from "@/lib/flutterwave";

export type PayState = { ok?: string; errors?: Record<string, string>; data?: unknown };

const phone = z.string().transform((v, ctx) => {
  const p = normaliseNgPhone(v);
  if (!p) { ctx.addIssue({ code: "custom", message: "Enter a Nigerian mobile number, like 0803 123 4567." }); return z.NEVER; }
  return p;
});
const method = z.enum(["card", "transfer", "ussd"], { message: "Choose how to pay." });

const orderSchema = z.object({
  plan: z.enum(["starter", "standard", "campus"], { message: "Choose a plan." }),
  billing: z.enum(["term", "year"]),
  school_name: z.string().trim().min(2, "Enter the school's name.").max(160),
  students: z.coerce.number({ message: "Enter how many students." }).int("Enter a whole number.").min(1, "Enter how many students.").max(20000, "For more than 20,000 students, talk to us."),
  contact_name: z.string().trim().min(2, "Enter your name.").max(120),
  phone,
  email: emailSchema,
  state: z.string().trim().min(2, "Choose your state.").max(40),
  method,
});

async function origin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
}
async function ip() {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** A school buying a plan: pay now (Flutterwave), or an invoice/quote when online payment or a price isn't set. */
export async function placeOrder(_prev: PayState, formData: FormData): Promise<PayState> {
  const parsed = orderSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  if (!(await checkRateLimitShared(`order:${await ip()}`, { max: 6, windowMs: 60 * 60_000 })).ok) {
    return { errors: { _form: "We've received several orders from here already. We'll be in touch soon." } };
  }
  const o = parsed.data;
  const quote = quoteFor(o.plan as PlanId, o.billing, o.students, await loadPricing());
  const reference = newReference("SCH");
  const key = flutterwaveKey();
  const db = createAdminClient();
  const { error } = await db.from("orders").insert({
    reference, plan: o.plan, billing: o.billing, students: o.students, school_name: o.school_name, contact_name: o.contact_name,
    phone: o.phone, email: o.email, state: o.state, method: o.method, amount: quote?.total ?? null, status: quote ? "pending" : "quote",
  });
  if (error) return { errors: { _form: "Something went wrong saving your order. Please try again." } };

  if (!quote) return { ok: `Thank you. We'll send a quote for ${o.school_name} to ${o.email} and call you on the number you gave.` };
  if (!key) return { ok: `Thank you. We'll email an invoice for ${naira(quote.total)} to ${o.email}, with bank details. Reference ${reference}.` };

  const init = await initializePayment({
    key, email: o.email, phone: o.phone, name: o.contact_name, amount: quote.total, reference, method: o.method,
    redirectUrl: `${await origin()}/pricing/done?ref=${reference}`,
    meta: { kind: "school_order", school: o.school_name, plan: o.plan, billing: o.billing, students: o.students },
  });
  if (!init.ok) return { errors: { _form: `The payment page couldn't open: ${init.error}. Your order is saved; we'll send an invoice instead.` } };
  redirect(init.url);
}

// ---------------------------------------------------------------------------- Parents

const childSchema = z.object({
  school_code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,8}(-[A-Z0-9]{2,8})?$/, "Enter the school code, like GFA-ABJ."),
  student_id: z.string().trim().min(1, "Enter the student ID.").max(40),
  phone,
});

type Child = { schoolId: string; schoolName: string; studentId: string; first: string; className: string | null; fee: number | null };

/**
 * Finds a child for a parent. All three must match: the school code, the student ID, and the parent's phone number
 * as the school has it. Without the phone, a guessed student ID would reveal a child's name.
 */
async function lookupChild(input: z.infer<typeof childSchema>): Promise<Child | null> {
  const db = createAdminClient();
  const { data: school } = await db.from("schools").select("id, name, parent_fee").eq("public_code", input.school_code).maybeSingle();
  if (!school) return null;
  const { data: student } = await db.from("students").select("id, first_name, status, classes(name)")
    .eq("school_id", school.id).ilike("admission_no", input.student_id).eq("status", "active").maybeSingle();
  if (!student) return null;
  const { data: links } = await db.from("student_guardians").select("guardians(phone)").eq("student_id", student.id);
  const phones = (links ?? []).map((l) => (l.guardians as unknown as { phone: string } | null)?.phone).filter(Boolean);
  if (!phones.includes(input.phone)) return null;
  return {
    schoolId: school.id, schoolName: school.name, studentId: student.id, first: student.first_name,
    className: (student.classes as unknown as { name: string } | null)?.name ?? null, fee: school.parent_fee === null ? null : Number(school.parent_fee),
  };
}

export type FoundChild = { first: string; className: string | null; schoolName: string; fee: number | null; online: boolean };

export async function findChild(_prev: PayState, formData: FormData): Promise<PayState> {
  const parsed = childSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  if (!(await checkRateLimitShared(`child:${await ip()}`, { max: 8, windowMs: 15 * 60_000 })).ok) {
    return { errors: { _form: "Too many tries. Please wait 15 minutes, or ask the school office for the codes." } };
  }
  const child = await lookupChild(parsed.data);
  if (!child) return { errors: { _form: "We couldn't find a match. Check the codes on the school's letter, and use the phone number the school has for you." } };
  const found: FoundChild = { first: child.first, className: child.className, schoolName: child.schoolName, fee: child.fee, online: !!flutterwaveKey() };
  return { data: found };
}

export async function payChildFee(_prev: PayState, formData: FormData): Promise<PayState> {
  const parsed = childSchema.extend({ method }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  if (!(await checkRateLimitShared(`childpay:${await ip()}`, { max: 6, windowMs: 15 * 60_000 })).ok) return { errors: { _form: "Too many tries. Please wait a few minutes." } };
  const child = await lookupChild(parsed.data);
  if (!child) return { errors: { _form: "We couldn't find a match. Check the codes and your phone number." } };
  if (child.fee === null) return { errors: { _form: `${child.schoolName} hasn't set up online payment for parents. Please pay at the school office.` } };
  const key = flutterwaveKey();
  if (!key) return { errors: { _form: "Online payment isn't switched on yet. Please pay at the school office for now." } };

  const reference = newReference("PAR");
  const db = createAdminClient();
  const { error } = await db.from("parent_payments").insert({
    reference, school_id: child.schoolId, student_id: child.studentId, phone: parsed.data.phone, amount: child.fee, method: parsed.data.method,
  });
  if (error) return { errors: { _form: "Something went wrong. Please try again." } };
  const init = await initializePayment({
    key, amount: child.fee, reference, method: parsed.data.method, phone: parsed.data.phone,
    // Flutterwave needs an email; parents pay with their phone, so receipts come by message from the school instead.
    email: `${parsed.data.phone.replace("+", "")}@parents.tapin.ng`,
    redirectUrl: `${await origin()}/pricing/done?ref=${reference}`,
    meta: { kind: "parent_fee", school_id: child.schoolId },
  });
  if (!init.ok) return { errors: { _form: `The payment page couldn't open: ${init.error}` } };
  redirect(init.url);
}
