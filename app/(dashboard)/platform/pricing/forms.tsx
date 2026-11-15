"use client";

import { useActionState, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, SelectField, useActionFeedback } from "@/components/forms/field";
import { Label } from "@/components/ui/label";
import { moveRow, saveAnnualDiscount, saveItem, savePlan } from "./actions";

export type ItemRow = { id: string; name: string; description: string | null; unit: string; unit_price: number; active: boolean };
export type PlanRow = { id: string; name: string; min_students: number; max_students: number | null; monthly_price: number; features: string[]; tier: "basic" | "premium"; active: boolean };

function ActiveBox({ name, defaultChecked, label }: { name: string; defaultChecked: boolean; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 accent-[var(--brand)]" /> {label}
    </label>
  );
}

export function ItemDialog({ item }: { item?: ItemRow }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(saveItem, {});
  useActionFeedback(state, () => setOpen(false));
  const e = state.errors ?? {};
  const k = item?.id ?? "new";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {item ? <Button variant="ghost" size="sm" aria-label={`Edit ${item.name}`}><Pencil className="size-4" aria-hidden /></Button>
          : <Button variant="outline" size="sm"><Plus className="size-4" aria-hidden /> Add item</Button>}
      </DialogTrigger>
      <DialogContent>
        <form action={action} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{item ? `Edit ${item.name}` : "Add a setup item"}</DialogTitle>
            <DialogDescription>A one-time item on quotes, e.g. printed lanyards. Price in naira.</DialogDescription>
          </DialogHeader>
          {item && <input type="hidden" name="id" value={item.id} />}
          <FormError state={state} />
          <Field name="name" id={`it-name-${k}`} label="Name" defaultValue={item?.name} error={e.name} required />
          <Field name="description" id={`it-desc-${k}`} label="Description (optional)" defaultValue={item?.description ?? ""} error={e.description} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field name="unit_price" id={`it-price-${k}`} label="Unit price (₦)" type="number" min={0} step="0.01" defaultValue={item?.unit_price ?? ""} error={e.unit_price} required />
            <Field name="unit" id={`it-unit-${k}`} label="Unit" placeholder="per card" defaultValue={item?.unit ?? "each"} error={e.unit} />
          </div>
          <ActiveBox name="active" defaultChecked={item?.active ?? true} label="Active (shown on new quotes)" />
          <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PlanDialog({ plan }: { plan?: PlanRow }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(savePlan, {});
  useActionFeedback(state, () => setOpen(false));
  const e = state.errors ?? {};
  const k = plan?.id ?? "new";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {plan ? <Button variant="ghost" size="sm" aria-label={`Edit ${plan.name}`}><Pencil className="size-4" aria-hidden /></Button>
          : <Button variant="outline" size="sm"><Plus className="size-4" aria-hidden /> Add plan</Button>}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <form action={action} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{plan ? `Edit ${plan.name}` : "Add a plan"}</DialogTitle>
            <DialogDescription>Monthly price in naira. Schools already on this plan keep their agreed price until you move them on Subscriptions.</DialogDescription>
          </DialogHeader>
          {plan && <input type="hidden" name="id" value={plan.id} />}
          <FormError state={state} />
          <Field name="name" id={`pl-name-${k}`} label="Name" defaultValue={plan?.name} error={e.name} required />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field name="min_students" id={`pl-min-${k}`} label="From (students)" type="number" min={0} defaultValue={plan?.min_students ?? 0} error={e.min_students} />
            <Field name="max_students" id={`pl-max-${k}`} label="To (empty = no limit)" type="number" min={1} defaultValue={plan?.max_students ?? ""} error={e.max_students} />
            <Field name="monthly_price" id={`pl-price-${k}`} label="Monthly price (₦)" type="number" min={0} step="0.01" defaultValue={plan?.monthly_price ?? ""} error={e.monthly_price} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`pl-feat-${k}`}>Features (one per line)</Label>
            <textarea id={`pl-feat-${k}`} name="features" rows={5} defaultValue={(plan?.features ?? []).join("\n")}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" />
          </div>
          <SelectField name="tier" id={`pl-tier-${k}`} label="Features unlocked" defaultValue={plan?.tier ?? "basic"} error={e.tier}>
            <option value="basic">Basic</option>
            <option value="premium">Premium (adds the emergency roll call)</option>
          </SelectField>
          <ActiveBox name="active" defaultChecked={plan?.active ?? true} label="Active (offered to new schools). Untick to retire it." />
          <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MoveButtons({ id, table, first, last, name }: { id: string; table: "price_items" | "subscription_plans"; first: boolean; last: boolean; name: string }) {
  const [, action, pending] = useActionState(moveRow, {});
  return (
    <form action={action} className="flex">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="table" value={table} />
      <Button type="submit" name="dir" value="up" variant="ghost" size="sm" disabled={pending || first} aria-label={`Move ${name} up`}><ArrowUp className="size-4" aria-hidden /></Button>
      <Button type="submit" name="dir" value="down" variant="ghost" size="sm" disabled={pending || last} aria-label={`Move ${name} down`}><ArrowDown className="size-4" aria-hidden /></Button>
    </form>
  );
}

export function AnnualForm({ months }: { months: number }) {
  const [state, action, pending] = useActionState(saveAnnualDiscount, {});
  useActionFeedback(state);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3" noValidate>
      <FormError state={state} />
      <Field name="annual_free_months" label="Free months when paying a year up front" type="number" min={0} max={6} defaultValue={months}
        error={state.errors?.annual_free_months} className="w-80" hint="0 = no yearly discount. 2 = pay 10 months for 12." />
      <Button type="submit" variant="outline" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
    </form>
  );
}
