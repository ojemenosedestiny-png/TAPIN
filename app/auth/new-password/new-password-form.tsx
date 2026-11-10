"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/forms/field";
import { setNewPassword, type NewPasswordState } from "./actions";

export function NewPasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<NewPasswordState, FormData>(setNewPassword, {});
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <p className="text-sm text-muted-foreground">For <span className="font-medium text-ink">{email}</span></p>
      <FormError state={state} />
      {/* Hidden username field helps password managers save the right login. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <Field name="password" label="New password" type="password" autoComplete="new-password" error={e.password}
        hint="At least 10 characters, with upper and lower case letters and a number." required />
      <Field name="confirm" label="Type it again" type="password" autoComplete="new-password" error={e.confirm} required />
      <Button type="submit" className="motion-press h-11 w-full" disabled={pending}>{pending ? "Saving…" : "Save and sign in"}</Button>
    </form>
  );
}
