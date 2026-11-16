"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** The message for the parents' WhatsApp group, ready to copy. */
export function ShareAssistant({ message }: { message: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">Tell parents: copy this into your parents&apos; WhatsApp group</p>
        <Button type="button" size="sm" variant="outline" onClick={async () => {
          try { await navigator.clipboard.writeText(message); setCopied(true); toast.success("Message copied."); }
          catch { toast.error("Couldn't copy. Select the text and copy it."); }
        }}><Copy className="size-4" aria-hidden /> {copied ? "Copied" : "Copy message"}</Button>
      </div>
      <p className="whitespace-pre-line text-sm text-ink">{message}</p>
      <p className="mt-2 text-xs text-muted-foreground">The number and a QR code are also on every parent&apos;s TapIn page and on the printed consent form.</p>
    </div>
  );
}
