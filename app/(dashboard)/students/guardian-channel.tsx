"use client";

import { useActionState } from "react";
import { useActionFeedback } from "@/components/forms/field";
import { setGuardianChannel } from "./actions";

/** SMS / WhatsApp switch for one guardian (falls back to SMS when WhatsApp isn't set up). */
export function GuardianChannel({ guardianId, channel }: { guardianId: string; channel: "sms" | "whatsapp" }) {
  const [state, action, pending] = useActionState(setGuardianChannel, {});
  useActionFeedback(state);
  return (
    <form action={action}>
      <input type="hidden" name="guardian_id" value={guardianId} />
      <select name="channel" defaultValue={channel} disabled={pending} aria-label="How this guardian gets alerts"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-8 rounded-md border border-input bg-card px-2 text-xs text-ink outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <option value="sms">SMS</option>
        <option value="whatsapp">WhatsApp</option>
      </select>
    </form>
  );
}
