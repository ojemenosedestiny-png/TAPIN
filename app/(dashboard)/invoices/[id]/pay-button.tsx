"use client";

import { useActionState } from "react";
import { CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/forms/field";
import { payInvoiceOnline } from "./actions";

/** Opens OPay's payment page for this invoice: card, bank transfer or USSD. */
export function PayOnlineButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(payInvoiceOnline, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <FormError state={state} />
      <Button type="submit" disabled={pending} className="motion-press"><CreditCard className="size-4" aria-hidden /> {pending ? "Opening OPay…" : "Pay online with OPay"}</Button>
      <p className="text-xs text-muted-foreground">Card, bank transfer or USSD. The invoice is marked paid as soon as OPay confirms.</p>
    </form>
  );
}
