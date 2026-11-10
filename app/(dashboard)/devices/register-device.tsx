"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, Plus, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/forms/field";

/** Registers a kiosk and shows its secret token exactly once. */
export function RegisterDevice() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const close = (o: boolean) => {
    if (!o && token && !copied && !confirm("Close without copying? The token can't be shown again.")) return;
    setOpen(o);
    if (!o) { setName(""); setToken(null); setError(null); setCopied(false); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.issues?.[0] ?? json.error ?? "Could not register the device.");
      setToken(json.token);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger asChild><Button><Plus className="size-4" /> Register kiosk</Button></DialogTrigger>
      <DialogContent>
        {!token ? (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <DialogHeader>
              <DialogTitle>Register a kiosk</DialogTitle>
              <DialogDescription>Each gate device gets its own secret token. You&apos;ll enter it once on the kiosk.</DialogDescription>
            </DialogHeader>
            <Field name="name" label="Device name" placeholder="Main Gate" value={name} onChange={(e) => setName(e.target.value)} error={error ?? undefined} required autoFocus />
            <DialogFooter><Button type="submit" disabled={busy || name.trim().length < 2}>{busy ? "Registering…" : "Register"}</Button></DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Copy the device token now</DialogTitle>
              <DialogDescription>Paste it into the kiosk at <span className="font-mono">/kiosk</span> on the gate device.</DialogDescription>
            </DialogHeader>
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> This is the only time the token is shown. TapIn stores only a scrambled copy.
            </p>
            <div className="break-all rounded-lg border border-border bg-muted px-3 py-3 font-mono text-sm text-ink" aria-label="Device token">{token}</div>
            <DialogFooter>
              <Button variant="outline" onClick={async () => {
                try { await navigator.clipboard.writeText(token); setCopied(true); toast.success("Token copied."); } catch { toast.error("Couldn't copy. Select the token and copy it manually."); }
              }}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy token"}
              </Button>
              <Button onClick={() => { setCopied(true); setOpen(false); setToken(null); setName(""); }}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
