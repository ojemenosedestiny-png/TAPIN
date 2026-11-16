"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FormError, useActionFeedback } from "@/components/forms/field";
import { Label } from "@/components/ui/label";
import { orderLines, type OrderItem } from "@/lib/school-orders";
import { cancelSchoolOrder, placeSchoolOrder } from "./actions";

const ngn = (n: number) => `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
const input = "h-10 w-28 rounded-md border border-input bg-card px-3 text-right text-sm tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Choose quantities; the total updates as you type. The server recalculates from current prices. */
export function OrderForm({ items }: { items: (OrderItem & { description: string | null })[] }) {
  const [state, action, pending] = useActionState(placeSchoolOrder, {});
  const [qty, setQty] = useState<Record<string, number>>({});
  const [formKey, setFormKey] = useState(0);
  useActionFeedback(state, () => { setQty({}); setFormKey((k) => k + 1); });
  const { lines, total } = useMemo(() => orderLines(items, qty), [items, qty]);
  const invoiceId = (state.data as { invoiceId?: string } | undefined)?.invoiceId;

  return (
    <form key={formKey} action={action} className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]" noValidate>
      <div className="space-y-3">
        <FormError state={state} />
        {state.ok && invoiceId && (
          <p className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-900">
            {state.ok} <Link href={`/invoices/${invoiceId}`} className="font-medium underline">Open the invoice</Link>
          </p>
        )}
        <ul className="divide-y divide-border rounded-xl border border-border">
          {items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <label htmlFor={`oq-${i.id}`} className="min-w-0 flex-1 text-sm">
                <span className="font-medium text-ink">{i.name}</span>
                <span className="block text-xs text-muted-foreground">{ngn(i.unit_price)} {i.unit}{i.description ? ` · ${i.description}` : ""}</span>
              </label>
              <input id={`oq-${i.id}`} name={`qty_${i.id}`} type="number" min={0} max={5000} inputMode="numeric" placeholder="0" className={input}
                onChange={(e) => setQty((q) => ({ ...q, [i.id]: Number(e.target.value) || 0 }))} />
            </li>
          ))}
        </ul>
        <div className="space-y-1.5">
          <Label htmlFor="order-note">Note for TapIn (optional)</Label>
          <textarea id="order-note" name="note" rows={2} maxLength={500} placeholder="e.g. Cards for the new JSS 1 class, deliver to the main gate"
            className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" />
        </div>
      </div>

      <aside className="h-fit space-y-3 rounded-xl bg-muted/50 p-5 lg:sticky lg:top-6" aria-live="polite">
        <p className="text-sm font-semibold text-ink">Your order</p>
        {lines.length === 0 ? <p className="text-sm text-muted-foreground">Enter how many you need.</p> : (
          <dl className="space-y-1.5 text-sm">
            {lines.map((l) => (
              <div key={l.item_id} className="flex justify-between gap-3"><dt className="text-muted-foreground">{l.quantity} × {l.description.replace(/ \(.*\)$/, "")}</dt><dd className="tabular-nums">{ngn(l.amount)}</dd></div>
            ))}
          </dl>
        )}
        <div className="flex justify-between gap-3 border-t border-border pt-2 text-base font-semibold text-ink"><span>Total</span><span className="tabular-nums">{ngn(total)}</span></div>
        <Button type="submit" className="w-full" disabled={pending || total <= 0}>{pending ? "Placing order…" : "Place order and get invoice"}</Button>
        <p className="text-xs text-muted-foreground">Pay by bank transfer using the details on the invoice. We deliver once payment arrives.</p>
      </aside>
    </form>
  );
}

export function CancelOrderButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(cancelSchoolOrder, {});
  useActionFeedback(state);
  return (
    <form action={action} onSubmit={(e) => { if (!window.confirm("Cancel this order? Its invoice will be voided.")) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>Cancel</Button>
    </form>
  );
}
