"use client";

import { useActionState, useState } from "react";
import { Check, Copy, Link2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError, useActionFeedback, type ActionState } from "@/components/forms/field";
import { shareMonthlyReport } from "./actions";

/** "Get link" for any month; "Send to director" when their phone is set. */
export function ShareReport({ month, hasDirector }: { month: string; hasDirector: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(shareMonthlyReport, {});
  const [copied, setCopied] = useState(false);
  useActionFeedback(state);
  const url = (state.data as { url?: string } | undefined)?.url;
  return (
    <div className="space-y-2 print:hidden">
      <form action={action} className="flex flex-wrap gap-2">
        <input type="hidden" name="month" value={month} />
        <Button type="submit" name="send" value="link" variant="outline" disabled={pending}><Link2 className="size-4" aria-hidden /> Get link</Button>
        {hasDirector && <Button type="submit" name="send" value="sms" variant="outline" disabled={pending}><Send className="size-4" aria-hidden /> Send to director</Button>}
      </form>
      <FormError state={state} />
      {url && (
        <div className="flex max-w-xl items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{url}</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(url).then(() => setCopied(true)); }}>
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}
    </div>
  );
}
