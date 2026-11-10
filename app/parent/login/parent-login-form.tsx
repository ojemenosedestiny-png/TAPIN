"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatNgPhone } from "@/lib/phone";
import { requestCode, verifyCode, type ParentLoginState } from "./actions";

export function ParentLoginForm() {
  const [phoneState, askCode, sending] = useActionState<ParentLoginState, FormData>(requestCode, { step: "phone" });
  const [codeState, check, checking] = useActionState<ParentLoginState, FormData>(verifyCode, { step: "code" });
  const onCodeStep = phoneState.step === "code" && codeState.step !== "phone";
  const phone = phoneState.phone;

  if (!onCodeStep) {
    return (
      <form action={askCode} className="space-y-5" noValidate>
        {(phoneState.error || codeState.error) && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{phoneState.error ?? codeState.error}</p>}
        <div className="space-y-2">
          <Label htmlFor="phone">Your mobile number</Label>
          <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" className="h-11 text-base" required />
          <p className="text-xs text-muted-foreground">The number your child&apos;s school has on file for you.</p>
        </div>
        <Button type="submit" className="motion-press h-11 w-full" disabled={sending}>{sending ? "Sending…" : "Text me a code"}</Button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <form action={check} className="space-y-5" noValidate>
        <p role="status" className="rounded-xl bg-brand-light/60 px-4 py-3 text-sm text-brand-dark">{phoneState.info}</p>
        {codeState.error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{codeState.error}</p>}
        <input type="hidden" name="phone" value={phone} />
        <div className="space-y-2">
          <Label htmlFor="code">Code sent to {phone ? formatNgPhone(phone) : "your phone"}</Label>
          <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} autoFocus
            className="h-12 text-center text-2xl tracking-[0.3em] tabular-nums" />
        </div>
        <Button type="submit" className="motion-press h-11 w-full" disabled={checking}>{checking ? "Checking…" : "Sign in"}</Button>
      </form>
      <form action={askCode} className="text-center">
        <input type="hidden" name="phone" value={phone} />
        <button type="submit" className="text-sm text-muted-foreground hover:text-ink hover:underline">Send a new code</button>
      </form>
    </div>
  );
}
