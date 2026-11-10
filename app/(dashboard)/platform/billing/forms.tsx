"use client";

import { useActionState, useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, useActionFeedback, withSuccessToast } from "@/components/forms/field";
import { Label } from "@/components/ui/label";
import { generateInvoices, savePlatformSettings, saveSchoolPricing, setInvoiceStatus } from "./actions";

type Pricing = { id: string; name: string; price_per_student: number; setup_fee: number; price_per_sms: number; billing_start: string | null; billing_email: string | null };

export function PricingDialog({ school }: { school: Pricing }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(saveSchoolPricing, {});
  useActionFeedback(state, () => setOpen(false));
  const e = state.errors ?? {};
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Pricing for ${school.name}`}><Pencil className="size-4" /> Pricing</Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>Pricing: {school.name}</DialogTitle>
            <DialogDescription>Amounts in naira. Invoices start from the billing start month.</DialogDescription>
          </DialogHeader>
          <input type="hidden" name="school_id" value={school.id} />
          <FormError state={state} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field name="price_per_student" label="Per student / month" type="number" min={0} step="0.01" defaultValue={school.price_per_student} error={e.price_per_student} />
            <Field name="setup_fee" label="Setup fee (once)" type="number" min={0} step="0.01" defaultValue={school.setup_fee} error={e.setup_fee} />
            <Field name="price_per_sms" label="Per SMS (0 = included)" type="number" min={0} step="0.01" defaultValue={school.price_per_sms} error={e.price_per_sms} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field name="billing_start" label="Billing starts" type="date" defaultValue={school.billing_start ?? ""} error={e.billing_start} />
            <Field name="billing_email" label="Invoices go to (email)" type="email" defaultValue={school.billing_email ?? ""} error={e.billing_email} />
          </div>
          <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save pricing"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function GenerateInvoices({ defaultMonth, schools }: { defaultMonth: string; schools: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(generateInvoices, {});
  useActionFeedback(state);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="period">Month</Label>
        <input id="period" name="period" type="month" defaultValue={defaultMonth}
          className="h-9 rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="invoice-school">School</Label>
        <select id="invoice-school" name="school_id" defaultValue=""
          className="h-9 w-48 rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <option value="">All schools</option>
          {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Issuing…" : "Issue invoices"}</Button>
      <FormError state={state} />
    </form>
  );
}

export function InvoiceStatusButton({ id, status, label, variant = "outline" }: { id: string; status: "paid" | "void" | "issued"; label: string; variant?: "outline" | "ghost" }) {
  // The button disappears once the status changes, so confirm straight from the action.
  const [, action, pending] = useActionState(withSuccessToast(setInvoiceStatus), {});
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <Button type="submit" size="sm" variant={variant} disabled={pending}>{label}</Button>
    </form>
  );
}

type Platform = { business_name: string; address: string | null; email: string | null; phone: string | null; bank_details: string | null; invoice_prefix: string };

export function PlatformSettingsForm({ settings }: { settings: Platform }) {
  const [state, action, pending] = useActionState(savePlatformSettings, {});
  useActionFeedback(state);
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError state={state} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_140px]">
        <Field name="business_name" label="Business name" defaultValue={settings.business_name} error={e.business_name} required />
        <Field name="invoice_prefix" label="Invoice prefix" defaultValue={settings.invoice_prefix} error={e.invoice_prefix} />
      </div>
      <Field name="address" label="Address" defaultValue={settings.address ?? ""} error={e.address} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field name="email" label="Email" type="email" defaultValue={settings.email ?? ""} error={e.email} />
        <Field name="phone" label="Phone" defaultValue={settings.phone ?? ""} error={e.phone} />
      </div>
      <Field name="bank_details" label="Pay to (bank, account name, account number)" defaultValue={settings.bank_details ?? ""} error={e.bank_details} />
      <Button type="submit" variant="outline" disabled={pending}>{pending ? "Saving…" : "Save business details"}</Button>
    </form>
  );
}
