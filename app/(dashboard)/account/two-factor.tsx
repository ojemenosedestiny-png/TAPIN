"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmEnroll, disableMfa, startEnroll } from "./actions";

export function TwoFactor({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (enabled) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-ink">
          <ShieldCheck className="size-5 text-success" aria-hidden /> Two-factor login is on. You&apos;ll be asked for a code each time you sign in.
        </p>
        <Button variant="outline" disabled={pending} onClick={() => start(async () => {
          if (!confirm("Turn off two-factor login? Your account will be protected by your password only.")) return;
          const r = await disableMfa();
          if (r.ok) { toast.success("Two-factor login turned off."); router.refresh(); } else toast.error(r.error ?? "Couldn't turn it off.");
        })}>
          <ShieldOff className="size-4" /> Turn off
        </Button>
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Add a 6-digit code from an app on your phone (Google Authenticator, Microsoft Authenticator or Authy) to your password.
          Strongly recommended for school admins.
        </p>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <Button disabled={pending} onClick={() => start(async () => {
          setError(null);
          const r = await startEnroll();
          if (r.ok) setSetup(r);
          else setError(r.error);
        })}>
          <ShieldCheck className="size-4" /> {pending ? "Starting…" : "Turn on two-factor login"}
        </Button>
      </div>
    );
  }

  return (
    <div className="motion-rise grid grid-cols-1 gap-6 sm:grid-cols-[200px_1fr]">
      <div className="size-[200px] rounded-xl border border-border bg-white p-3">
        {/* Supabase returns the QR code as an SVG data URL. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={setup.qr} alt="QR code to scan with your authenticator app" className="size-full" />
      </div>
      <form className="space-y-4" onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await confirmEnroll(setup.factorId, code);
          if (r.ok) { toast.success("Two-factor login is on."); setSetup(null); router.refresh(); }
          else setError(r.error ?? "That code didn't work.");
        });
      }}>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
          <li>Open your authenticator app and add an account.</li>
          <li>Scan the QR code, or type this key: <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{setup.secret}</code></li>
          <li>Enter the 6-digit code the app shows.</li>
        </ol>
        <div className="space-y-2">
          <Label htmlFor="mfa-code">Code from the app</Label>
          <Input id="mfa-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7}
            className="h-11 w-40 text-center text-lg tracking-[0.25em] tabular-nums" aria-invalid={!!error} />
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>{pending ? "Checking…" : "Turn on"}</Button>
          <Button type="button" variant="ghost" onClick={() => { setSetup(null); setCode(""); setError(null); }}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
