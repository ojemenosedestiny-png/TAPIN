"use client";

import { useActionState, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, SelectField, useActionFeedback } from "@/components/forms/field";
import { nextRenewal, type Billing } from "@/lib/subscriptions";
import { moveToCurrentPrice, renewSubscription, saveSubscription, toggleSuspend } from "./actions";

export type SubPlan = { id: string; name: string; monthly_price: number; active: boolean };
export type SubRow = { school_id: string; plan_id: string; agreed_monthly_price: number; billing: Billing; started_on: string; renews_on: string; notes: string | null };

export function SubscriptionDialog({ schoolId, schoolName, plans, sub, today }: { schoolId: string; schoolName: string; plans: SubPlan[]; sub?: SubRow; today: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(saveSubscription, {});
  useActionFeedback(state, () => setOpen(false));
  const e = state.errors ?? {};
  const choosable = plans.filter((p) => p.active || p.id === sub?.plan_id);
  const [planId, setPlanId] = useState(sub?.plan_id ?? choosable[0]?.id ?? "");
  const [price, setPrice] = useState<string>(String(sub?.agreed_monthly_price ?? choosable[0]?.monthly_price ?? ""));
  const [billing, setBilling] = useState<Billing>(sub?.billing ?? "monthly");
  const [start, setStart] = useState(sub?.started_on ?? today);
  const k = schoolId;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {sub ? <Button variant="ghost" size="sm" aria-label={`Edit subscription for ${schoolName}`}><Pencil className="size-4" aria-hidden /></Button>
          : <Button variant="outline" size="sm"><Plus className="size-4" aria-hidden /> Set plan</Button>}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <form action={action} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{schoolName}</DialogTitle>
            <DialogDescription>The agreed price stays the same when you change a plan&apos;s price, until you move this school.</DialogDescription>
          </DialogHeader>
          <input type="hidden" name="school_id" value={schoolId} />
          <FormError state={state} />
          <SelectField name="plan_id" id={`sb-plan-${k}`} label="Plan" value={planId} error={e.plan_id}
            onChange={(ev) => {
              setPlanId(ev.target.value);
              if (!sub) setPrice(String(plans.find((p) => p.id === ev.target.value)?.monthly_price ?? ""));
            }}>
            {choosable.map((p) => <option key={p.id} value={p.id}>{p.name} · ₦{p.monthly_price.toLocaleString("en-NG")}/month{p.active ? "" : " (retired)"}</option>)}
          </SelectField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field name="agreed_monthly_price" id={`sb-price-${k}`} label="Agreed monthly price (₦)" type="number" min={0} step="0.01" value={price}
              onChange={(ev) => setPrice(ev.target.value)} error={e.agreed_monthly_price} required />
            <SelectField name="billing" id={`sb-billing-${k}`} label="Pays" value={billing} onChange={(ev) => setBilling(ev.target.value as Billing)} error={e.billing}>
              <option value="monthly">Monthly</option>
              <option value="annual">Yearly</option>
            </SelectField>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field name="started_on" id={`sb-start-${k}`} label="Started" type="date" value={start} onChange={(ev) => setStart(ev.target.value)} error={e.started_on} required />
            <Field name="renews_on" id={`sb-renew-${k}`} label="Renews (empty = one period after start)" type="date" defaultValue={sub?.renews_on ?? ""} error={e.renews_on} hint={!sub && start ? `Default: ${nextRenewal(start, billing)}` : undefined} />
          </div>
          <Field name="notes" id={`sb-notes-${k}`} label="Notes (optional)" defaultValue={sub?.notes ?? ""} error={e.notes} />
          <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RowAction({ schoolId, act, label, variant = "outline", confirm }: { schoolId: string; act: typeof renewSubscription; label: string; variant?: "outline" | "ghost"; confirm?: string }) {
  const [state, action, pending] = useActionState(act, {});
  useActionFeedback(state);
  return (
    <form action={action} onSubmit={(ev) => { if (confirm && !window.confirm(confirm)) ev.preventDefault(); }}>
      <input type="hidden" name="school_id" value={schoolId} />
      <Button type="submit" size="sm" variant={variant} disabled={pending}>{label}</Button>
    </form>
  );
}

export function RenewButton({ schoolId, until }: { schoolId: string; until: string }) {
  return <RowAction schoolId={schoolId} act={renewSubscription} label="Renew" confirm={`Mark as paid and renew until ${until}?`} />;
}
export function SuspendButton({ schoolId, suspended }: { schoolId: string; suspended: boolean }) {
  return <RowAction schoolId={schoolId} act={toggleSuspend} variant="ghost" label={suspended ? "Resume" : "Suspend"} confirm={suspended ? undefined : "Mark this school as suspended?"} />;
}
export function RepriceButton({ schoolId, price }: { schoolId: string; price: string }) {
  return <RowAction schoolId={schoolId} act={moveToCurrentPrice} variant="ghost" label="Move to current price" confirm={`Change this school's monthly price to ${price}?`} />;
}
