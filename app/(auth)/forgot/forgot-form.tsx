"use client";

import { useActionState } from "react";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/forms/field";
import { requestReset, type ForgotState } from "./actions";

export function ForgotForm() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(requestReset, {});
  if (state.sent) {
    return (
      <div className="motion-rise flex flex-col items-center gap-3 text-center" role="status">
        <MailCheck className="size-10 text-brand" aria-hidden />
        <p className="font-medium text-ink">Check your email</p>
        <p className="text-sm text-muted-foreground">If that address has a TapIn account, a reset link is on its way. It works once and expires in an hour.</p>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormError state={state} />
      <Field name="email" label="Email" type="email" autoComplete="email" error={state.errors?.email} required />
      <Button type="submit" className="motion-press h-11 w-full" disabled={pending}>{pending ? "Sending…" : "Email me a reset link"}</Button>
    </form>
  );
}
