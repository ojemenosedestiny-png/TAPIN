"use client";

import { useActionState } from "react";
import { PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormError, useActionFeedback } from "@/components/forms/field";
import { savePortalLink, testPortalLink } from "./portal-actions";

export type PortalLinkView = { url: string; key_tail: string; match_by: "card" | "admission"; enabled: boolean };

export function PortalLinkForm({ link }: { link: PortalLinkView | null }) {
  const [state, action, pending] = useActionState(savePortalLink, {});
  useActionFeedback(state);
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError state={state} />
      <Field name="url" label="Portal tap address" defaultValue={link?.url ?? ""} placeholder="https://yourschool.com/api/kiosk/tap"
        error={e.url} hint="From the portal's kiosk guide. The website address alone also works." autoComplete="off" spellCheck={false} />
      <Field name="api_key" label="Kiosk key" type="password" autoComplete="new-password" spellCheck={false}
        placeholder={link ? `Saved (ends …${link.key_tail}). Leave blank to keep it.` : "Paste the key from the portal (starts nwek_)"}
        error={e.api_key} hint="In the portal: Manage → Card tap-in → Add kiosk. Shown only once there." />
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink">Match children by</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {([
            ["card", "Card number", "The portal links each new card once (under New cards)."],
            ["admission", "Admission number", "Only if TapIn's admission numbers are the portal's student IDs."],
          ] as const).map(([value, title, hint]) => (
            <label key={value} className="flex cursor-pointer gap-3 rounded-xl border border-border p-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-light/40">
              <input type="radio" name="match_by" value={value} defaultChecked={(link?.match_by ?? "card") === value} className="mt-1 accent-brand" />
              <span><span className="block font-medium text-ink">{title}</span><span className="text-xs text-muted-foreground">{hint}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="enabled" defaultChecked={link?.enabled ?? true} className="size-4 accent-brand" />
        Send each student sign-in to the portal
      </label>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : link ? "Save changes" : "Connect portal"}</Button>
    </form>
  );
}

export function PortalTestButton() {
  const [state, action, pending] = useActionState(testPortalLink, {});
  useActionFeedback(state);
  return (
    <form action={action} className="space-y-2">
      <Button type="submit" variant="outline" disabled={pending}><PlugZap className="size-4" aria-hidden /> {pending ? "Testing…" : "Test connection"}</Button>
      <FormError state={state} />
    </form>
  );
}
