"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cancelMfa, verifyMfaCode, type MfaState } from "./actions";

export function MfaForm() {
  const [state, action, pending] = useActionState<MfaState, FormData>(verifyMfaCode, {});
  return (
    <div className="space-y-5">
      <form action={action} className="space-y-5" noValidate>
        {state.error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{state.error}</p>}
        <div className="space-y-2">
          <Label htmlFor="code">6-digit code</Label>
          <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} autoFocus
            className="h-12 text-center text-2xl tracking-[0.3em] tabular-nums" aria-invalid={!!state.error} />
        </div>
        <Button type="submit" className="motion-press h-11 w-full" disabled={pending}>{pending ? "Checking…" : "Continue"}</Button>
      </form>
      <form action={cancelMfa} className="text-center">
        <button type="submit" className="text-sm text-muted-foreground hover:text-ink hover:underline">Use a different account</button>
      </form>
    </div>
  );
}
