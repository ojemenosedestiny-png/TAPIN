"use client";

import { useActionState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { withSuccessToast } from "@/components/forms/field";
import { answerEarlyPickup } from "./actions";

// The row disappears once answered, so the confirmation is shown as soon as the action returns.
const answer = withSuccessToast(answerEarlyPickup);

/** Approve or decline a parent's early pickup request. */
export function RequestButtons({ id, child }: { id: string; child: string }) {
  const [state, action, pending] = useActionState(answer, {});
  return (
    <form action={action} className="flex shrink-0 gap-1.5">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" name="decision" value="approve" size="sm" disabled={pending} aria-label={`Approve early pickup for ${child}`}>
        <Check className="size-4" aria-hidden /> Approve
      </Button>
      <Button type="submit" name="decision" value="decline" size="sm" variant="ghost" disabled={pending} aria-label={`Decline early pickup for ${child}`}>
        <X className="size-4" aria-hidden />
      </Button>
      {state.errors?._form && <p role="alert" className="sr-only">{state.errors._form}</p>}
    </form>
  );
}
