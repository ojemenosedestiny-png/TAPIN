"use client";

import { useActionState, useEffect } from "react";
import { CheckCheck, RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActionFeedback } from "@/components/forms/field";
import { toast } from "sonner";
import { markAllRead, retrySms, sendQueuedNow } from "./actions";

function useErrorToast(state: { errors?: Record<string, string> }) {
  useEffect(() => {
    if (state.errors?._form) toast.error(state.errors._form);
  }, [state]);
}

export function RetryButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(retrySms, {});
  useActionFeedback(state);
  useErrorToast(state);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}><RotateCcw className="size-3.5" /> Retry</Button>
    </form>
  );
}

export function SendNowButton({ disabled }: { disabled?: boolean }) {
  const [state, action, pending] = useActionState(sendQueuedNow, {});
  useActionFeedback(state);
  useErrorToast(state);
  return (
    <form action={action}>
      <Button type="submit" variant="outline" size="sm" disabled={pending || disabled}><Send className="size-3.5" /> {pending ? "Sending…" : "Send now"}</Button>
    </form>
  );
}

export function MarkAllReadButton() {
  const [state, action, pending] = useActionState(markAllRead, {});
  useActionFeedback(state);
  return (
    <form action={action}>
      <Button type="submit" variant="ghost" size="sm" disabled={pending}><CheckCheck className="size-4" /> Mark all read</Button>
    </form>
  );
}
